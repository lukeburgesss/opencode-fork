import { useEffect, useState } from "react"
import { Button, FlatList, Text, TextInput, View } from "react-native"
import {
  interruptSession,
  listPermissions,
  listSessions,
  openSessionEvents,
  replyPermission,
  sendPrompt,
  type RemoteConfig,
  type SessionSummary,
} from "./api"

// Minimal Expo scaffold: session list, prompt send, SSE event view,
// interrupt button, permission approve/deny. fetch + EventSource only.
export function App(props: { config: RemoteConfig }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeID, setActiveID] = useState<string | undefined>(undefined)
  const [prompt, setPrompt] = useState("")
  const [events, setEvents] = useState<string[]>([])
  const [permissions, setPermissions] = useState<Array<{ id: string }>>([])
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    listSessions(props.config)
      .then((result) => setSessions(result.data))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [props.config])

  useEffect(() => {
    if (!activeID) return
    const source = openSessionEvents(props.config, activeID, {
      onMessage: (data) => setEvents((current) => [...current.slice(-99), data]),
      onError: () => source.close(),
    })
    return () => source.close()
  }, [activeID, props.config])

  useEffect(() => {
    if (!activeID) return
    listPermissions(props.config, activeID)
      .then((result) => setPermissions(result.data))
      .catch(() => setPermissions([]))
  }, [activeID, events.length, props.config])

  const send = async () => {
    if (!activeID || !prompt.trim()) return
    await sendPrompt(props.config, activeID, prompt.trim())
    setPrompt("")
  }

  return (
    <View>
      {error ? <Text>{error}</Text> : null}
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <Button title={item.title ?? item.id} onPress={() => setActiveID(item.id)} />}
      />
      <TextInput value={prompt} onChangeText={setPrompt} placeholder="Send prompt" />
      <Button
        title="Send"
        disabled={!activeID || !prompt.trim()}
        onPress={() => {
          void send()
        }}
      />
      <Button
        title="Interrupt"
        disabled={!activeID}
        onPress={() => {
          if (activeID) void interruptSession(props.config, activeID)
        }}
      />
      {permissions.map((request) => (
        <View key={request.id}>
          <Text>{request.id}</Text>
          <Button
            title="Approve"
            onPress={() => {
              if (activeID) void replyPermission(props.config, activeID, request.id, "once")
            }}
          />
          <Button
            title="Deny"
            onPress={() => {
              if (activeID) void replyPermission(props.config, activeID, request.id, "reject")
            }}
          />
        </View>
      ))}
      {events.map((event, index) => (
        <Text key={index}>{event}</Text>
      ))}
    </View>
  )
}
