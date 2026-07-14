const API = "https://discord.com/api/v10";

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export async function verifyInteraction(publicKey, signature, timestamp, body) {
  const ed = await import("@noble/ed25519");
  const msg = new TextEncoder().encode(timestamp + body);
  const sig = hexToBytes(signature);
  const pub = hexToBytes(publicKey);
  return ed.verify(sig, msg, pub);
}

export async function api(method, path, token, body = null) {
  const headers = {};
  if (token) headers["Authorization"] = `Bot ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`Discord API ${method} ${path} → ${res.status}:`, JSON.stringify(json));
  }
  return json;
}

export async function getOrCreateWebhook(channelId, token, db) {
  const cached = await db.prepare("SELECT webhookId, webhookToken FROM webhooks WHERE channelId = ?").first(channelId);
  if (cached) return { id: cached.webhookId, token: cached.webhookToken };
  const wh = await api("POST", `/channels/${channelId}/webhooks`, token, { name: "ChillZoneBot" });
  if (!wh || !wh.id) throw new Error("Failed to create webhook");
  await db.prepare("INSERT OR REPLACE INTO webhooks (channelId, webhookId, webhookToken) VALUES (?, ?, ?)").run(channelId, wh.id, wh.token);
  return { id: wh.id, token: wh.token };
}

export async function sendWebhookMessage(webhookId, webhookToken, data) {
  return api("POST", `/webhooks/${webhookId}/${webhookToken}?wait=true`, null, data);
}

export async function editWebhookMessage(webhookId, webhookToken, messageId, data) {
  return api("PATCH", `/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`, null, data);
}

export async function deleteWebhookMessage(webhookId, webhookToken, messageId) {
  return api("DELETE", `/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`, null);
}

export async function sendMessage(channelId, token, data) {
  return api("POST", `/channels/${channelId}/messages`, token, data);
}

export async function editMessage(channelId, messageId, token, data) {
  return api("PATCH", `/channels/${channelId}/messages/${messageId}`, token, data);
}

export async function deleteMessage(channelId, messageId, token) {
  return api("DELETE", `/channels/${channelId}/messages/${messageId}`, token);
}

export async function createThread(channelId, token, data) {
  return api("POST", `/channels/${channelId}/threads`, token, data);
}

export async function addThreadMember(threadId, userId, token) {
  return api("PUT", `/channels/${threadId}/members/${userId}`, token);
}

export async function removeThreadMember(threadId, userId, token) {
  return api("DELETE", `/channels/${threadId}/members/${userId}`, token);
}

export async function deleteChannel(channelId, token) {
  return api("DELETE", `/channels/${channelId}`, token);
}

export async function sendDM(userId, token, content) {
  const dm = await api("POST", "/users/@me/channels", token, { recipient_id: userId });
  if (!dm || !dm.id) throw new Error("Failed to create DM channel");
  return api("POST", `/channels/${dm.id}/messages`, token, typeof content === "string" ? { content } : content);
}

export async function fetchMember(guildId, userId, token) {
  return api("GET", `/guilds/${guildId}/members/${userId}`, token);
}

export async function fetchUser(userId, token) {
  return api("GET", `/users/${userId}`, token);
}

export async function editInteractionResponse(token, interactionToken, data) {
  return api("PATCH", `/webhooks/${token}/${interactionToken}/messages/@original`, null, data);
}

export async function followUp(token, interactionToken, data) {
  return api("POST", `/webhooks/${token}/${interactionToken}`, null, data);
}

export const EPHEMERAL = 64;

export function ephemeral(content) {
  return { type: 4, data: { content, flags: EPHEMERAL } };
}

export function respond(content) {
  return { type: 4, data: typeof content === "string" ? { content } : content };
}

export function defer(ephemeral = false) {
  return { type: 5, data: ephemeral ? { flags: EPHEMERAL } : {} };
}

export function deferUpdate() {
  return { type: 6 };
}

export function update(data) {
  return { type: 7, data: typeof data === "string" ? { content: data } : data };
}

export function modal(data) {
  return { type: 9, data };
}
