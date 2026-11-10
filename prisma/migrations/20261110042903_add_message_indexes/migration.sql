-- CreateIndex
CREATE INDEX "Conversation_ownerId_lastMessageAt_idx" ON "Conversation"("ownerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_sitterId_lastMessageAt_idx" ON "Conversation"("sitterId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Message_conversationId_readAt_idx" ON "Message"("conversationId", "readAt");
