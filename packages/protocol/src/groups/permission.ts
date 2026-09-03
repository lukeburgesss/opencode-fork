import { Agent } from "@opencode-ai/schema/agent"
import { Location } from "@opencode-ai/schema/location"
import { Permission } from "@opencode-ai/schema/permission"
import { PermissionSaved } from "@opencode-ai/schema/permission-saved"
import { Project } from "@opencode-ai/schema/project"
import { Session } from "@opencode-ai/schema/session"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { PermissionNotFoundError, SessionNotFoundError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const ApprovalDecision = Schema.Literals(["once", "always", "deny"]).annotate({
  identifier: "ApprovalDecision",
})
export type ApprovalDecision = typeof ApprovalDecision.Type

export const ApprovalStatus = Schema.Literals(["pending", "decided", "expired"]).annotate({
  identifier: "ApprovalStatus",
})
export type ApprovalStatus = typeof ApprovalStatus.Type

export const ApprovalAuditEntry = Schema.Struct({
  decision: ApprovalDecision,
  actor: Schema.String,
  deviceID: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  at: Schema.Number,
}).annotate({ identifier: "ApprovalAuditEntry" })
export type ApprovalAuditEntry = typeof ApprovalAuditEntry.Type

export const ApprovalInfo = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.optional(Schema.String),
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  created_at: Schema.Number,
  expires_at: Schema.Number,
  timeout_ms: Schema.Number,
  status: ApprovalStatus,
  decision: Schema.optional(ApprovalDecision),
  decided_at: Schema.optional(Schema.Number),
  decided_by: Schema.optional(Schema.String),
  deviceID: Schema.optional(Schema.String),
  audit: Schema.Array(ApprovalAuditEntry),
}).annotate({ identifier: "ApprovalInfo" })
export type ApprovalInfo = typeof ApprovalInfo.Type

export const ApprovalJobInfo = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  title: Schema.optional(Schema.String),
  status: Schema.Literals(["running", "completed", "error", "cancelled"]),
  started_at: Schema.Number,
  completed_at: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "ApprovalJobInfo" })
export type ApprovalJobInfo = typeof ApprovalJobInfo.Type

export const DefaultApprovalTimeoutMs = 10 * 60 * 1000

export const makePermissionGroup = <
  LocationId extends HttpApiMiddleware.AnyId,
  LocationService,
  SessionLocationId extends HttpApiMiddleware.AnyId,
  SessionLocationService,
>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
  sessionLocationMiddleware: Context.Key<SessionLocationId, SessionLocationService>,
) =>
  HttpApiGroup.make("server.permission")
    .add(
      HttpApiEndpoint.get("permission.request.list", "/api/permission/request", {
        query: LocationQuery,
        success: Location.response(Schema.Array(Permission.Request)),
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.permission.request.list",
            summary: "List pending permission requests",
            description: "Retrieve pending permission requests for a location.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("permission.saved.list", "/api/permission/saved", {
        query: Schema.Struct({ projectID: Project.ID.pipe(Schema.optional) }),
        success: Schema.Struct({ data: Schema.Array(PermissionSaved.Info) }),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.permission.saved.list",
          summary: "List saved permissions",
          description: "Retrieve saved permissions, optionally filtered by project.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.delete("permission.saved.remove", "/api/permission/saved/:id", {
        params: { id: PermissionSaved.ID },
        success: HttpApiSchema.NoContent,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.permission.saved.remove",
          summary: "Remove saved permission",
          description: "Remove a saved permission by ID.",
        }),
      ),
    )
    // Effect applies group middleware only to endpoints already added; session endpoints use session placement below.
    .middleware(locationMiddleware)
    .add(
      HttpApiEndpoint.post("session.permission.create", "/api/session/:sessionID/permission", {
        params: { sessionID: Session.ID },
        payload: Schema.Struct({
          id: Permission.ID.pipe(Schema.optional),
          action: Permission.Request.fields.action,
          resources: Permission.Request.fields.resources,
          save: Permission.Request.fields.save,
          metadata: Permission.Request.fields.metadata,
          source: Permission.Request.fields.source,
          agent: Agent.ID.pipe(Schema.optional),
        }),
        success: Schema.Struct({
          data: Schema.Struct({ id: Permission.ID, effect: Permission.Effect }),
        }),
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.permission.create",
            summary: "Create permission request",
            description: "Evaluate and, when approval is required, create a permission request for a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.permission.list", "/api/session/:sessionID/permission", {
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(Permission.Request) }),
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.permission.list",
            summary: "List session permission requests",
            description: "Retrieve pending permission requests owned by a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("session.permission.get", "/api/session/:sessionID/permission/:requestID", {
        params: { sessionID: Session.ID, requestID: Permission.ID },
        success: Schema.Struct({ data: Permission.Request }),
        error: [SessionNotFoundError, PermissionNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.permission.get",
            summary: "Get permission request",
            description: "Retrieve a pending permission request owned by a session.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("session.permission.reply", "/api/session/:sessionID/permission/:requestID/reply", {
        params: { sessionID: Session.ID, requestID: Permission.ID },
        payload: Schema.Struct({
          reply: Permission.Reply,
          message: Schema.String.pipe(Schema.optional),
        }),
        success: HttpApiSchema.NoContent,
        error: [SessionNotFoundError, PermissionNotFoundError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "v2.session.permission.reply",
            summary: "Reply to pending permission request",
            description: "Respond to a pending permission request owned by a session.",
          }),
        ),
    )
    // Approval queue (F4): global endpoints, no location middleware. They sit
    // behind the global Authorization middleware only, so Bearer device tokens
    // work for mobile approve/deny. "jobs" is a reserved requestID.
    .add(
      HttpApiEndpoint.post("approval.request", "/api/approval", {
        payload: Schema.Struct({
          sessionID: Schema.optional(Schema.String),
          action: Schema.String,
          resources: Schema.Array(Schema.String),
          timeout_ms: Schema.optional(Schema.Number),
        }),
        success: Schema.Struct({ data: ApprovalInfo }),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.approval.request",
          summary: "Create approval request",
          description:
            "Create a unified approval request with per-request timeout (default 10min). Used by background agents.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("approval.list", "/api/approval", {
        query: Schema.Struct({
          sessionID: Schema.optional(Schema.String),
          status: Schema.optional(ApprovalStatus),
        }),
        success: Schema.Struct({ data: Schema.Array(ApprovalInfo) }),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.approval.list",
          summary: "List approval requests",
          description: "List unified approval requests with timeout/expires_at and audit fields.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("approval.jobs.list", "/api/approval/jobs", {
        success: Schema.Struct({ data: Schema.Array(ApprovalJobInfo) }),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.approval.jobs.list",
          summary: "List background jobs",
          description: "List background jobs alongside pending approvals for the dashboard.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("approval.get", "/api/approval/:requestID", {
        params: { requestID: Schema.String },
        success: Schema.Struct({ data: ApprovalInfo }),
        error: PermissionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.approval.get",
          summary: "Get approval request",
          description: "Retrieve one approval request with timeout/expires_at and audit fields.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("approval.decide", "/api/approval/:requestID/decide", {
        params: { requestID: Schema.String },
        payload: Schema.Struct({
          decision: ApprovalDecision,
          message: Schema.optional(Schema.String),
          actor: Schema.optional(Schema.String),
          deviceID: Schema.optional(Schema.String),
        }),
        success: HttpApiSchema.NoContent,
        error: PermissionNotFoundError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.approval.decide",
          summary: "Decide approval request",
          description: "Allow once/always or deny an approval request. Records who/when/device audit.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "permissions", description: "Experimental permission routes." }))
