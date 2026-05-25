package org.example.gateway.service;

import org.springframework.stereotype.Service;
import java.io.*;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

/**
 * MessageService - Persistent messaging system for CAAC
 * Supports:
 * - Direct messages between any two users
 * - Broadcast to admin (user -> admin channel)
 * - Read/unread tracking
 * - Conversation threads (between two users)
 */
@Service
public class MessageService {
    public static class Message {
        public final long id;
        public final String from;
        public final String to;
        public final String content;
        public final String timestamp;
        public boolean read;

        public Message(long id, String from, String to, String content, String timestamp, boolean read) {
            this.id = id;
            this.from = from;
            this.to = to;
            this.content = content;
            this.timestamp = timestamp;
            this.read = read;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("from", from);
            m.put("to", to);
            m.put("content", content);
            m.put("timestamp", timestamp);
            m.put("read", read);
            return m;
        }

        public String toLine() {
            return String.join("|", String.valueOf(id), from, to, content.replace("|", "\\|").replace("\n", "\\n"), timestamp, String.valueOf(read));
        }
    }

    private final List<Message> messages = new CopyOnWriteArrayList<>();
    private final AtomicLong idCounter = new AtomicLong(1);
    private static final String DATA_DIR = "data";
    private static final String MSG_FILE = "data/messages.dat";
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    public MessageService() {
        try { Files.createDirectories(Paths.get(DATA_DIR)); } catch (Exception ignored) {}
        loadFromDisk();
        System.out.println("[MessageService] Loaded " + messages.size() + " messages from disk");
    }

    // ================================================================
    // SEND
    // ================================================================

    public Message send(String from, String to, String content) {
        if (from == null || to == null || content == null || content.trim().isEmpty()) return null;
        String ts = LocalDateTime.now().format(FMT);
        Message msg = new Message(idCounter.getAndIncrement(), from.toLowerCase(), to.toLowerCase(), content.trim(), ts, false);
        messages.add(msg);
        appendToDisk(msg);
        System.out.println("[Message] " + from + " -> " + to + ": " + content.substring(0, Math.min(50, content.length())));
        return msg;
    }

    // ================================================================
    // QUERIES
    // ================================================================

    public static boolean isAdminSender(String name) {
        if (name == null) return false;
        return name.equals("admin") || name.endsWith(" admin");
    }

    public List<Message> getConversation(String user1, String user2) {
        String a = user1.toLowerCase(), b = user2.toLowerCase();
        boolean adminThread = isAdminSender(a) || isAdminSender(b);
        return messages.stream()
                .filter(m -> {
                    if (adminThread) {
                        // Match: (any admin to user) or (user to admin)
                        String user = isAdminSender(a) ? b : a;
                        return (isAdminSender(m.from) && m.to.equals(user)) || (m.from.equals(user) && isAdminSender(m.to));
                    }
                    return (m.from.equals(a) && m.to.equals(b))|| (m.from.equals(b) && m.to.equals(a));
                }).sorted((x, y) -> Long.compare(y.id, x.id)).collect(Collectors.toList());
    }

    // Get conversation with a user
    public List<Message> getAdminConversation(String adminUsername, String partner) {
        String p = partner.toLowerCase();
        return messages.stream()
                .filter(m -> {
                    // Any admin to partner, or partner to any admin
                    return (isAdminSender(m.from) && m.to.equals(p))|| (m.from.equals(p) && isAdminSender(m.to));
                }).sorted((x, y) -> Long.compare(y.id, x.id)).collect(Collectors.toList());
    }

    public List<Message> getInbox(String username) {
        return messages.stream().filter(m -> m.to.equalsIgnoreCase(username)).sorted((x, y) -> Long.compare(y.id, x.id)).collect(Collectors.toList());
    }

    public List<Message> getAllForUser(String username) {
        String u = username.toLowerCase();
        return messages.stream().filter(m -> m.from.equals(u) || m.to.equals(u)).sorted((x, y) -> Long.compare(y.id, x.id)).collect(Collectors.toList());
    }

    public List<Map<String, Object>> getConversationList(String username) {
        return buildConversationList(username, false);
    }

    public List<Map<String, Object>> getAdminConversationList(String username) {
        return buildConversationList(username, true);
    }

    private List<Map<String, Object>> buildConversationList(String username, boolean includeAdminInbox) {
        String u = username.toLowerCase();
        Map<String, Message> latestByPartner = new LinkedHashMap<>();
        List<Message> sorted = messages.stream().filter(m -> {
                    // Own messages
                    if (m.from.equals(u) || m.to.equals(u)) return true;
                    if (includeAdminInbox && (isAdminSender(m.from) || isAdminSender(m.to))) return true;
                    return false;
                }).sorted((a, b) -> Long.compare(b.id, a.id)).collect(Collectors.toList());

        for (Message m : sorted) {
            String partner;
            boolean senderIsAdmin = isAdminSender(m.from);
            boolean recipientIsAdmin = isAdminSender(m.to);
            if (includeAdminInbox) {
                // Admin view
                if (senderIsAdmin) {
                    partner = m.to;
                } else if (recipientIsAdmin) {
                    partner = m.from;
                } else {
                    partner = m.from.equals(u) ? m.to : m.from;
                }
            } else {
                // User view
                partner = m.from.equals(u) ? m.to : m.from;
                if (isAdminSender(partner)) partner = "admin";
            }

            if (partner.equals(u)) continue;
            if (includeAdminInbox && isAdminSender(partner)) continue;
            if (!latestByPartner.containsKey(partner)) {
                latestByPartner.put(partner, m);
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<String, Message> entry : latestByPartner.entrySet()) {
            Map<String, Object> conv = new LinkedHashMap<>();
            conv.put("partner", entry.getKey());
            conv.put("lastMessage", entry.getValue().content.substring(0,Math.min(80, entry.getValue().content.length())));
            conv.put("lastTimestamp", entry.getValue().timestamp);

            // Count unread messages
            int unread;
            if (includeAdminInbox) {
                String p = entry.getKey();
                unread = (int) messages.stream().filter(msg -> msg.from.equals(p) && isAdminSender(msg.to) && !msg.read).count();
            } else {
                unread = countUnread(u, entry.getKey());
            }
            conv.put("unread", unread);
            result.add(conv);
        }
        return result;
    }

    // Counts unread messages from a specific sender to a user.
    public int countUnread(String username, String from) {
        String u = username.toLowerCase(), f = from.toLowerCase();
        return (int) messages.stream().filter(m -> {
                    if (!m.read && m.to.equals(u)) {
                        if (isAdminSender(f)) return isAdminSender(m.from);
                        return m.from.equals(f);
                    }
                    return false;
                })
                .count();
    }

    // Total unread messages for a user
    public int countTotalUnread(String username) {
        String u = username.toLowerCase();
        return (int) messages.stream().filter(m -> m.to.equals(u) && !m.read).count();
    }

    public void markAllRead(String username) {
        String u = username.toLowerCase();
        boolean changed = false;
        for (Message m : messages) {
            if (m.to.equals(u) && !m.read) {
                m.read = true;
                changed = true;
            }
        }
        if (changed) saveToDisk();
    }

    public void markRead(String receiver, String sender) {
        String r = receiver.toLowerCase(), s = sender.toLowerCase();
        boolean changed = false;
        for (Message m : messages) {
            if (!m.read) {
                // For direct match
                if (m.to.equals(r) && m.from.equals(s)) { m.read = true; changed = true; }
                // If receiver is checking admin chat, mark messages from any admin sender
                else if (isAdminSender(s) && m.to.equals(r) && isAdminSender(m.from)) { m.read = true; changed = true; }
                // If admin is checking user chat, mark messages from user to any admin
                else if (isAdminSender(r) && m.from.equals(s) && isAdminSender(m.to)) { m.read = true; changed = true; }
            }
        }
        if (changed) saveToDisk();
    }

    // All messages (admin)
    public List<Message> getAll() {
        List<Message> copy = new ArrayList<>(messages);
        Collections.reverse(copy);
        return copy;
    }

    // ================================================================
    // PERSISTENCE
    // ================================================================

    private void appendToDisk(Message msg) {
        try (FileWriter fw = new FileWriter(MSG_FILE, true)) {
            fw.write(msg.toLine() + "\n");
        } catch (IOException e) {
            System.err.println("[MessageService] Write failed: " + e.getMessage());
        }
    }

    private void saveToDisk() {
        try (PrintWriter writer = new PrintWriter(new FileWriter(MSG_FILE))) {
            for (Message m : messages) {
                writer.println(m.toLine());
            }
        } catch (IOException e) {
            System.err.println("[MessageService] Save failed: " + e.getMessage());
        }
    }

    private void loadFromDisk() {
        Path path = Paths.get(MSG_FILE);
        if (!Files.exists(path)) return;
        try (BufferedReader reader = Files.newBufferedReader(path)) {
            String line;
            long maxId = 0;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;
                String[] p = line.split("\\|", 6);
                if (p.length < 6) continue;
                try {
                    long id = Long.parseLong(p[0]);
                    String content = p[3].replace("\\|", "|").replace("\\n", "\n");
                    boolean read = Boolean.parseBoolean(p[5]);
                    messages.add(new Message(id, p[1], p[2], content, p[4], read));
                    if (id > maxId) maxId = id;
                } catch (Exception ignored) {}
            }
            idCounter.set(maxId + 1);
        } catch (Exception e) {
            System.err.println("[MessageService] Load failed: " + e.getMessage());
        }
    }
}
