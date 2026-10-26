-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('SHORT_CARE', 'REGULAR_CARE');

-- CreateEnum
CREATE TYPE "Region" AS ENUM ('SEOUL', 'GYEONGGI', 'INCHEON', 'GANGWON', 'CHUNGBUK', 'CHUNGNAM', 'SEJONG', 'DAEJEON', 'JEONBUK', 'JEONNAM', 'GWANGJU', 'GYEONGBUK', 'GYEONGNAM', 'DAEGU', 'ULSAN', 'BUSAN', 'JEJU');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'SITTER');

-- CreateEnum
CREATE TYPE "CareRequestStatus" AS ENUM ('OPEN', 'MATCHED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuoteType" AS ENUM ('GENERAL', 'DESIGNATED');

-- CreateTable
CREATE TABLE "User" (
    "id" BIGSERIAL NOT NULL,
    "nickname" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerProfile" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "profileImageUrl" TEXT,
    "preferredServiceTypes" "ServiceType"[],
    "livingRegion" "Region",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitterService" (
    "id" BIGSERIAL NOT NULL,
    "sitterProfileId" BIGINT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,

    CONSTRAINT "SitterService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitterProfile" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "profileImageUrl" TEXT,
    "description" TEXT,
    "gender" "Gender" NOT NULL,
    "shortIntroduction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitterServiceRegion" (
    "id" BIGSERIAL NOT NULL,
    "sitterProfileId" BIGINT NOT NULL,
    "region" "Region" NOT NULL,

    CONSTRAINT "SitterServiceRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareRequest" (
    "id" BIGSERIAL NOT NULL,
    "ownerId" BIGINT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "zonecode" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "detailAddress" TEXT,
    "sido" TEXT NOT NULL,
    "sigungu" TEXT NOT NULL,
    "bname" TEXT,
    "region" "Region" NOT NULL,
    "status" "CareRequestStatus" NOT NULL,
    "confirmedQuoteId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),

    CONSTRAINT "CareRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignatedRequest" (
    "id" BIGSERIAL NOT NULL,
    "careRequestId" BIGINT NOT NULL,
    "sitterId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignatedRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectedRequest" (
    "id" BIGSERIAL NOT NULL,
    "designatedRequestId" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectedRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgnoredRequest" (
    "id" BIGSERIAL NOT NULL,
    "careRequestId" BIGINT NOT NULL,
    "sitterId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IgnoredRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" BIGSERIAL NOT NULL,
    "careRequestId" BIGINT NOT NULL,
    "sitterId" BIGINT NOT NULL,
    "type" "QuoteType" NOT NULL,
    "price" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" BIGSERIAL NOT NULL,
    "ownerId" BIGINT NOT NULL,
    "sitterId" BIGINT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" BIGSERIAL NOT NULL,
    "conversationId" BIGINT NOT NULL,
    "senderId" BIGINT NOT NULL,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" BIGSERIAL NOT NULL,
    "careRequestId" BIGINT NOT NULL,
    "ownerId" BIGINT NOT NULL,
    "sitterId" BIGINT NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_nickname_role_key" ON "User"("nickname", "role");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_role_key" ON "User"("email", "role");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerProfile_userId_key" ON "OwnerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SitterService_sitterProfileId_serviceType_key" ON "SitterService"("sitterProfileId", "serviceType");

-- CreateIndex
CREATE UNIQUE INDEX "SitterProfile_userId_key" ON "SitterProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SitterServiceRegion_sitterProfileId_region_key" ON "SitterServiceRegion"("sitterProfileId", "region");

-- CreateIndex
CREATE UNIQUE INDEX "CareRequest_confirmedQuoteId_key" ON "CareRequest"("confirmedQuoteId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignatedRequest_careRequestId_sitterId_key" ON "DesignatedRequest"("careRequestId", "sitterId");

-- CreateIndex
CREATE UNIQUE INDEX "RejectedRequest_designatedRequestId_key" ON "RejectedRequest"("designatedRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "IgnoredRequest_careRequestId_sitterId_key" ON "IgnoredRequest"("careRequestId", "sitterId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_careRequestId_sitterId_key" ON "Quote"("careRequestId", "sitterId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_ownerId_sitterId_key" ON "Conversation"("ownerId", "sitterId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_careRequestId_key" ON "Review"("careRequestId");

-- AddForeignKey
ALTER TABLE "OwnerProfile" ADD CONSTRAINT "OwnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitterService" ADD CONSTRAINT "SitterService_sitterProfileId_fkey" FOREIGN KEY ("sitterProfileId") REFERENCES "SitterProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitterProfile" ADD CONSTRAINT "SitterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitterServiceRegion" ADD CONSTRAINT "SitterServiceRegion_sitterProfileId_fkey" FOREIGN KEY ("sitterProfileId") REFERENCES "SitterProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareRequest" ADD CONSTRAINT "CareRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareRequest" ADD CONSTRAINT "CareRequest_confirmedQuoteId_fkey" FOREIGN KEY ("confirmedQuoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignatedRequest" ADD CONSTRAINT "DesignatedRequest_careRequestId_fkey" FOREIGN KEY ("careRequestId") REFERENCES "CareRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignatedRequest" ADD CONSTRAINT "DesignatedRequest_sitterId_fkey" FOREIGN KEY ("sitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RejectedRequest" ADD CONSTRAINT "RejectedRequest_designatedRequestId_fkey" FOREIGN KEY ("designatedRequestId") REFERENCES "DesignatedRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgnoredRequest" ADD CONSTRAINT "IgnoredRequest_careRequestId_fkey" FOREIGN KEY ("careRequestId") REFERENCES "CareRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgnoredRequest" ADD CONSTRAINT "IgnoredRequest_sitterId_fkey" FOREIGN KEY ("sitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_careRequestId_fkey" FOREIGN KEY ("careRequestId") REFERENCES "CareRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_sitterId_fkey" FOREIGN KEY ("sitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_sitterId_fkey" FOREIGN KEY ("sitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_careRequestId_fkey" FOREIGN KEY ("careRequestId") REFERENCES "CareRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_sitterId_fkey" FOREIGN KEY ("sitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
