using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore;
using Pomelo.EntityFrameworkCore.MySql.Scaffolding.Internal;

namespace api.Data;

public partial class DailyCheckDbContext : DbContext
{
    public DailyCheckDbContext()
    {
    }

    public DailyCheckDbContext(DbContextOptions<DailyCheckDbContext> options)
        : base(options)
    {
    }

    public virtual DbSet<ChatConversation> ChatConversations { get; set; }

    public virtual DbSet<ChatConversationMember> ChatConversationMembers { get; set; }

    public virtual DbSet<ChatFileRecord> ChatFileRecords { get; set; }

    public virtual DbSet<ChatGroupActionLog> ChatGroupActionLogs { get; set; }

    public virtual DbSet<ChatGroupJoinRequest> ChatGroupJoinRequests { get; set; }

    public virtual DbSet<ChatMessage> ChatMessages { get; set; }

    public virtual DbSet<ChatMessageDeletion> ChatMessageDeletions { get; set; }

    public virtual DbSet<ChatMessageReceipt> ChatMessageReceipts { get; set; }

    public virtual DbSet<Checkin> Checkins { get; set; }

    public virtual DbSet<CheckinPlan> CheckinPlans { get; set; }

    public virtual DbSet<CheckinPlanTimeSlot> CheckinPlanTimeSlots { get; set; }

    public virtual DbSet<Efmigrationshistory> Efmigrationshistories { get; set; }

    public virtual DbSet<SoftDeleteLog> SoftDeleteLogs { get; set; }

    public virtual DbSet<User> Users { get; set; }

    public virtual DbSet<UserActivity> UserActivities { get; set; }

    public virtual DbSet<UserBlacklistRecord> UserBlacklistRecords { get; set; }

    public virtual DbSet<UserBlock> UserBlocks { get; set; }

    public virtual DbSet<UserFriendRequest> UserFriendRequests { get; set; }

    public virtual DbSet<UserFriendship> UserFriendships { get; set; }

    public virtual DbSet<UserOauthAccount> UserOauthAccounts { get; set; }
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder
            .UseCollation("utf8mb4_0900_ai_ci")
            .HasCharSet("utf8mb4");

        modelBuilder.Entity<ChatConversation>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("chat_conversations", tb => tb.HasComment("聊天会话主表（支持群管理扩展）"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.IsActive, "idx_chat_conversations_active");

            entity.HasIndex(e => e.DisbandedByUserId, "idx_chat_conversations_disbanded_by");

            entity.HasIndex(e => e.LastMessageAt, "idx_chat_conversations_last_message_at");

            entity.HasIndex(e => e.OwnerUserId, "idx_chat_conversations_owner");

            entity.HasIndex(e => e.ConversationStatus, "idx_chat_conversations_status");

            entity.HasIndex(e => e.ConversationType, "idx_chat_conversations_type");

            entity.Property(e => e.Id)
                .HasComment("会话ID")
                .HasColumnName("id");
            entity.Property(e => e.AvatarKey)
                .HasMaxLength(512)
                .HasComment("会话头像存储标识")
                .HasColumnName("avatar_key");
            entity.Property(e => e.ConversationStatus)
                .HasDefaultValueSql("'active'")
                .HasComment("会话生命周期状态：active=正常活跃,disbanded=已解散,archived=已归档")
                .HasColumnType("enum('active','disbanded','archived')")
                .HasColumnName("conversation_status");
            entity.Property(e => e.ConversationType)
                .HasDefaultValueSql("'group'")
                .HasComment("会话类型：direct=双人，group=多人/群聊")
                .HasColumnType("enum('direct','group')")
                .HasColumnName("conversation_type");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.DisbandReason)
                .HasMaxLength(255)
                .HasComment("群解散原因说明")
                .HasColumnName("disband_reason");
            entity.Property(e => e.DisbandedAt)
                .HasComment("群解散时间")
                .HasColumnType("datetime")
                .HasColumnName("disbanded_at");
            entity.Property(e => e.DisbandedByUserId)
                .HasComment("解散操作人用户ID")
                .HasColumnName("disbanded_by_user_id");
            entity.Property(e => e.IsActive)
                .IsRequired()
                .HasDefaultValueSql("'1'")
                .HasComment("会话状态：1=可用，0=已停用")
                .HasColumnName("is_active");
            entity.Property(e => e.LastMessageAt)
                .HasComment("最后一条消息发送时间")
                .HasColumnType("datetime")
                .HasColumnName("last_message_at");
            entity.Property(e => e.MemberLimit)
                .HasDefaultValueSql("'500'")
                .HasComment("群成员人数上限")
                .HasColumnName("member_limit");
            entity.Property(e => e.OwnerUserId)
                .HasComment("群主/创建者用户ID")
                .HasColumnName("owner_user_id");
            entity.Property(e => e.Title)
                .HasMaxLength(128)
                .HasComment("会话标题（群聊可配置）")
                .HasColumnName("title");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.DisbandedByUser).WithMany(p => p.ChatConversationDisbandedByUsers)
                .HasForeignKey(d => d.DisbandedByUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_chat_conversations_disbanded_by");

            entity.HasOne(d => d.OwnerUser).WithMany(p => p.ChatConversationOwnerUsers)
                .HasForeignKey(d => d.OwnerUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_chat_conversations_owner");
        });

        modelBuilder.Entity<ChatConversationMember>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("chat_conversation_members", tb => tb.HasComment("会话成员关系表（支持邀请、踢出、禁言）"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.ConversationId, "idx_chat_members_conversation");

            entity.HasIndex(e => new { e.ConversationId, e.LeftAt }, "idx_chat_members_conversation_active");

            entity.HasIndex(e => new { e.ConversationId, e.LeftAt, e.JoinedAt }, "idx_chat_members_conversation_left_joined");

            entity.HasIndex(e => e.InvitedByUserId, "idx_chat_members_invited_by");

            entity.HasIndex(e => e.MutedByUserId, "idx_chat_members_muted_by");

            entity.HasIndex(e => e.RemovedByUserId, "idx_chat_members_removed_by");

            entity.HasIndex(e => e.MembershipStatus, "idx_chat_members_status");

            entity.HasIndex(e => e.UserId, "idx_chat_members_user");

            entity.HasIndex(e => new { e.UserId, e.LeftAt }, "idx_chat_members_user_active");

            entity.HasIndex(e => new { e.UserId, e.LeftAt, e.ConversationId, e.IsPinned, e.UpdatedAt }, "idx_chat_members_user_left_conversation");

            entity.HasIndex(e => new { e.ConversationId, e.UserId }, "ux_chat_members_conversation_user").IsUnique();

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.ConversationId)
                .HasComment("会话ID")
                .HasColumnName("conversation_id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.InvitedAt)
                .HasComment("邀请时间")
                .HasColumnType("datetime")
                .HasColumnName("invited_at");
            entity.Property(e => e.InvitedByUserId)
                .HasComment("邀请人用户ID")
                .HasColumnName("invited_by_user_id");
            entity.Property(e => e.IsMuted)
                .HasComment("是否消息免打扰：1是，0否")
                .HasColumnName("is_muted");
            entity.Property(e => e.IsPinned)
                .HasComment("是否置顶会话：1是，0否")
                .HasColumnName("is_pinned");
            entity.Property(e => e.IsHidden)
                .HasComment("是否对该用户隐藏会话（伪删除标记）")
                .HasColumnName("is_hidden");
            entity.Property(e => e.HistoryClearedBeforeMessageId)
                .HasComment("聊天记录清除到此消息ID（含），仅对该用户生效")
                .HasColumnName("history_cleared_before_message_id");
            entity.Property(e => e.HistoryClearedAt)
                .HasComment("聊天记录清除时间（仅该用户）")
                .HasColumnType("datetime")
                .HasColumnName("history_cleared_at");
            entity.Property(e => e.JoinedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("加入时间")
                .HasColumnType("datetime")
                .HasColumnName("joined_at");
            entity.Property(e => e.LastReadMessageId)
                .HasComment("最后已读消息ID（逻辑引用）")
                .HasColumnName("last_read_message_id");
            entity.Property(e => e.LeftAt)
                .HasComment("离开时间（NULL表示仍在会话中）")
                .HasColumnType("datetime")
                .HasColumnName("left_at");
            entity.Property(e => e.MemberRole)
                .HasDefaultValueSql("'member'")
                .HasComment("成员角色")
                .HasColumnType("enum('owner','admin','member')")
                .HasColumnName("member_role");
            entity.Property(e => e.MembershipStatus)
                .HasDefaultValueSql("'active'")
                .HasComment("成员状态（active：活跃，left：已离开，kicked：被踢出）")
                .HasColumnType("enum('active','left','kicked')")
                .HasColumnName("membership_status");
            entity.Property(e => e.MuteMode)
                .HasComment("禁言模式（temporary：临时，permanent：永久）")
                .HasColumnType("enum('temporary','permanent')")
                .HasColumnName("mute_mode");
            entity.Property(e => e.MuteReason)
                .HasMaxLength(255)
                .HasComment("禁言原因")
                .HasColumnName("mute_reason");
            entity.Property(e => e.MuteUntil)
                .HasComment("禁言截至时间（NULL表示不禁言）")
                .HasColumnType("datetime")
                .HasColumnName("mute_until");
            entity.Property(e => e.MutedAt)
                .HasComment("禁言开始时间")
                .HasColumnType("datetime")
                .HasColumnName("muted_at");
            entity.Property(e => e.MutedByUserId)
                .HasComment("禁言操作人用户ID")
                .HasColumnName("muted_by_user_id");
            entity.Property(e => e.RemovedByUserId)
                .HasComment("移除操作人用户ID")
                .HasColumnName("removed_by_user_id");
            entity.Property(e => e.RemovedReason)
                .HasMaxLength(255)
                .HasComment("离开或移除原因")
                .HasColumnName("removed_reason");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");
            entity.Property(e => e.UserId)
                .HasComment("用户ID")
                .HasColumnName("user_id");

            entity.HasOne(d => d.Conversation).WithMany(p => p.ChatConversationMembers)
                .HasForeignKey(d => d.ConversationId)
                .HasConstraintName("fk_chat_members_conversation");

            entity.HasOne(d => d.InvitedByUser).WithMany(p => p.ChatConversationMemberInvitedByUsers)
                .HasForeignKey(d => d.InvitedByUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_chat_members_invited_by");

            entity.HasOne(d => d.MutedByUser).WithMany(p => p.ChatConversationMemberMutedByUsers)
                .HasForeignKey(d => d.MutedByUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_chat_members_muted_by");

            entity.HasOne(d => d.RemovedByUser).WithMany(p => p.ChatConversationMemberRemovedByUsers)
                .HasForeignKey(d => d.RemovedByUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_chat_members_removed_by");

            entity.HasOne(d => d.User).WithMany(p => p.ChatConversationMemberUsers)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("fk_chat_members_user");
        });

        modelBuilder.Entity<ChatFileRecord>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("chat_file_records", tb => tb.HasComment("聊天文件元数据记录表，用于权限验证与文件追溯"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.ConversationId, "idx_chat_file_records_conversation");

            entity.HasIndex(e => e.CreatedAt, "idx_chat_file_records_created");

            entity.HasIndex(e => e.IsDeleted, "idx_chat_file_records_deleted");

            entity.HasIndex(e => e.UploaderUserId, "idx_chat_file_records_uploader");

            entity.HasIndex(e => e.FileKey, "ux_chat_file_records_file_key").IsUnique();

            entity.Property(e => e.Id)
                .HasComment("自增主键")
                .HasColumnName("id");
            entity.Property(e => e.ContentType)
                .HasMaxLength(255)
                .HasComment("MIME类型")
                .HasColumnName("content_type");
            entity.Property(e => e.ConversationId)
                .HasComment("所属会话ID")
                .HasColumnName("conversation_id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.FileKey)
                .HasMaxLength(128)
                .HasComment("文件唯一标识（SHA256哈希或组合键）")
                .HasColumnName("file_key");
            entity.Property(e => e.FileSize)
                .HasComment("文件实际存储大小（字节）")
                .HasColumnName("file_size");
            entity.Property(e => e.IsDeleted)
                .HasComment("软删除标记：0-未删除，1-已删除")
                .HasColumnName("is_deleted");
            entity.Property(e => e.OriginalFilename)
                .HasMaxLength(255)
                .HasComment("原始文件名（不含路径）")
                .HasColumnName("original_filename");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");
            entity.Property(e => e.UploaderUserId)
                .HasComment("上传者用户ID")
                .HasColumnName("uploader_user_id");

            entity.HasOne(d => d.Conversation).WithMany(p => p.ChatFileRecords)
                .HasForeignKey(d => d.ConversationId)
                .HasConstraintName("fk_chat_file_records_conversation");

            entity.HasOne(d => d.UploaderUser).WithMany(p => p.ChatFileRecords)
                .HasForeignKey(d => d.UploaderUserId)
                .HasConstraintName("fk_chat_file_records_uploader");
        });

        modelBuilder.Entity<ChatGroupActionLog>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("chat_group_action_logs", tb => tb.HasComment("群操作日志表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.ActionType, "idx_chat_group_logs_action_type");

            entity.HasIndex(e => new { e.ConversationId, e.CreatedAt }, "idx_chat_group_logs_conversation_created");

            entity.HasIndex(e => e.RelatedMessageId, "idx_chat_group_logs_message");

            entity.HasIndex(e => e.OperatorUserId, "idx_chat_group_logs_operator");

            entity.HasIndex(e => e.TargetUserId, "idx_chat_group_logs_target");

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.ActionPayload)
                .HasComment("额外JSON负载数据")
                .HasColumnType("json")
                .HasColumnName("action_payload");
            entity.Property(e => e.ActionReason)
                .HasMaxLength(255)
                .HasComment("操作原因")
                .HasColumnName("action_reason");
            entity.Property(e => e.ActionType)
                .HasComment("群操作类型")
                .HasColumnType("enum('create','invite','join','kick','mute','unmute','disband','transfer_owner','set_admin','unset_admin','leave')")
                .HasColumnName("action_type");
            entity.Property(e => e.ConversationId)
                .HasComment("群聊会话ID")
                .HasColumnName("conversation_id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.OperatorUserId)
                .HasComment("操作者用户ID")
                .HasColumnName("operator_user_id");
            entity.Property(e => e.RelatedMessageId)
                .HasComment("关联系统消息ID")
                .HasColumnName("related_message_id");
            entity.Property(e => e.TargetUserId)
                .HasComment("目标用户ID")
                .HasColumnName("target_user_id");

            entity.HasOne(d => d.Conversation).WithMany(p => p.ChatGroupActionLogs)
                .HasForeignKey(d => d.ConversationId)
                .HasConstraintName("fk_chat_group_logs_conversation");

            entity.HasOne(d => d.OperatorUser).WithMany(p => p.ChatGroupActionLogOperatorUsers)
                .HasForeignKey(d => d.OperatorUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_chat_group_logs_operator");

            entity.HasOne(d => d.RelatedMessage).WithMany(p => p.ChatGroupActionLogs)
                .HasForeignKey(d => d.RelatedMessageId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_chat_group_logs_message");

            entity.HasOne(d => d.TargetUser).WithMany(p => p.ChatGroupActionLogTargetUsers)
                .HasForeignKey(d => d.TargetUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_chat_group_logs_target");
        });

        modelBuilder.Entity<ChatGroupJoinRequest>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("chat_group_join_requests", tb => tb.HasComment("群聊加群申请记录表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => new { e.ConversationId, e.RequestStatus, e.CreatedAt }, "idx_group_join_requests_conversation_status");

            entity.HasIndex(e => e.HandledByUserId, "idx_group_join_requests_handled_by");

            entity.HasIndex(e => new { e.ConversationId, e.RequesterUserId, e.RequestStatus }, "idx_group_join_requests_pair_status");

            entity.HasIndex(e => new { e.RequesterUserId, e.RequestStatus, e.CreatedAt }, "idx_group_join_requests_requester_status");

            entity.HasIndex(e => new { e.RequestStatus, e.ExpireAt }, "idx_group_join_requests_status_expire");

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.ConversationId)
                .HasComment("群聊会话ID")
                .HasColumnName("conversation_id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.ExpireAt)
                .HasComment("申请过期时间")
                .HasColumnType("datetime")
                .HasColumnName("expire_at");
            entity.Property(e => e.HandledAt)
                .HasComment("处理时间")
                .HasColumnType("datetime")
                .HasColumnName("handled_at");
            entity.Property(e => e.HandledByUserId)
                .HasComment("处理人用户ID")
                .HasColumnName("handled_by_user_id");
            entity.Property(e => e.RejectReason)
                .HasMaxLength(255)
                .HasComment("拒绝原因")
                .HasColumnName("reject_reason");
            entity.Property(e => e.RequestMessage)
                .HasMaxLength(255)
                .HasComment("申请附言")
                .HasColumnName("request_message");
            entity.Property(e => e.RequestStatus)
                .HasDefaultValueSql("'pending'")
                .HasComment("申请状态：pending=待处理,approved=已通过,rejected=已拒绝,expired=已过期")
                .HasColumnType("enum('pending','approved','rejected','expired')")
                .HasColumnName("request_status");
            entity.Property(e => e.RequesterUserId)
                .HasComment("申请人用户ID")
                .HasColumnName("requester_user_id");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Conversation).WithMany(p => p.ChatGroupJoinRequests)
                .HasForeignKey(d => d.ConversationId)
                .HasConstraintName("fk_group_join_requests_conversation");

            entity.HasOne(d => d.HandledByUser).WithMany(p => p.ChatGroupJoinRequestHandledByUsers)
                .HasForeignKey(d => d.HandledByUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_group_join_requests_handled_by");

            entity.HasOne(d => d.RequesterUser).WithMany(p => p.ChatGroupJoinRequestRequesterUsers)
                .HasForeignKey(d => d.RequesterUserId)
                .HasConstraintName("fk_group_join_requests_requester");
        });

        modelBuilder.Entity<ChatMessage>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("chat_messages", tb => tb.HasComment("聊天消息表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => new { e.ConversationId, e.Id }, "idx_chat_messages_conversation_seq");

            entity.HasIndex(e => new { e.ConversationId, e.CreatedAt }, "idx_chat_messages_conversation_time");

            entity.HasIndex(e => e.ReplyToMessageId, "idx_chat_messages_reply");

            entity.HasIndex(e => e.RecalledByUserId, "idx_chat_messages_recalled_by");

            entity.HasIndex(e => e.SenderUserId, "idx_chat_messages_sender");

            entity.Property(e => e.Id)
                .HasComment("消息ID")
                .HasColumnName("id");
            entity.Property(e => e.Content)
                .HasComment("消息文本内容")
                .HasColumnType("text")
                .HasColumnName("content");
            entity.Property(e => e.ConversationId)
                .HasComment("会话ID")
                .HasColumnName("conversation_id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("发送时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.Extra)
                .HasComment("扩展字段(JSON)，如图片/文件信息、@信息等")
                .HasColumnType("json")
                .HasColumnName("extra");
            entity.Property(e => e.IsRecalled)
                .HasComment("是否撤回：1是，0否")
                .HasColumnName("is_recalled");
            entity.Property(e => e.MessageType)
                .HasDefaultValueSql("'text'")
                .HasComment("消息类型")
                .HasColumnType("enum('text','image','video','audio','file','system')")
                .HasColumnName("message_type");
            entity.Property(e => e.RecalledAt)
                .HasComment("撤回时间")
                .HasColumnType("datetime")
                .HasColumnName("recalled_at");
            entity.Property(e => e.RecalledByUserId)
                .HasComment("执行撤回的用户ID")
                .HasColumnName("recalled_by_user_id");
            entity.Property(e => e.RecallPrompt)
                .HasMaxLength(255)
                .HasComment("管理撤回提示（在原消息位置展示）")
                .HasColumnName("recall_prompt");
            entity.Property(e => e.ReplyToMessageId)
                .HasComment("引用回复的消息ID")
                .HasColumnName("reply_to_message_id");
            entity.Property(e => e.SenderUserId)
                .HasComment("发送者用户ID")
                .HasColumnName("sender_user_id");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Conversation).WithMany(p => p.ChatMessages)
                .HasForeignKey(d => d.ConversationId)
                .HasConstraintName("fk_chat_messages_conversation");

            entity.HasOne(d => d.ReplyToMessage).WithMany(p => p.InverseReplyToMessage)
                .HasForeignKey(d => d.ReplyToMessageId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_chat_messages_reply");

            entity.HasOne(d => d.SenderUser).WithMany(p => p.ChatMessages)
                .HasForeignKey(d => d.SenderUserId)
                .HasConstraintName("fk_chat_messages_sender");
        });

        modelBuilder.Entity<ChatMessageDeletion>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("chat_message_deletions", tb => tb.HasComment("聊天消息按用户伪删除标记表（仅删除者不可见）"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.UserId, "idx_chat_message_deletions_user");

            entity.HasIndex(e => new { e.MessageId, e.UserId }, "ux_chat_message_deletions_message_user").IsUnique();

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.MessageId)
                .HasComment("被隐藏的消息ID")
                .HasColumnName("message_id");
            entity.Property(e => e.UserId)
                .HasComment("执行隐藏的用户ID（仅该用户不可见）")
                .HasColumnName("user_id");
            entity.Property(e => e.Reason)
                .HasMaxLength(255)
                .HasComment("删除原因说明")
                .HasColumnName("reason");
            entity.Property(e => e.DeletedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("删除（隐藏）时间")
                .HasColumnType("datetime")
                .HasColumnName("deleted_at");

            entity.HasOne(d => d.Message).WithMany(p => p.ChatMessageDeletions)
                .HasForeignKey(d => d.MessageId)
                .HasConstraintName("fk_chat_message_deletions_message");

            entity.HasOne(d => d.User).WithMany(p => p.ChatMessageDeletions)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("fk_chat_message_deletions_user");
        });

        modelBuilder.Entity<ChatMessageReceipt>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("chat_message_receipts", tb => tb.HasComment("消息已读回执表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.ReadAt, "idx_chat_receipts_read_at");

            entity.HasIndex(e => e.UserId, "idx_chat_receipts_user");

            entity.HasIndex(e => new { e.MessageId, e.UserId }, "ux_chat_receipts_message_user").IsUnique();

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.MessageId)
                .HasComment("消息ID")
                .HasColumnName("message_id");
            entity.Property(e => e.ReadAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("已读时间")
                .HasColumnType("datetime")
                .HasColumnName("read_at");
            entity.Property(e => e.UserId)
                .HasComment("已读用户ID")
                .HasColumnName("user_id");

            entity.HasOne(d => d.Message).WithMany(p => p.ChatMessageReceipts)
                .HasForeignKey(d => d.MessageId)
                .HasConstraintName("fk_chat_receipts_message");

            entity.HasOne(d => d.User).WithMany(p => p.ChatMessageReceipts)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("fk_chat_receipts_user");
        });

        modelBuilder.Entity<Checkin>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("checkins", tb => tb.HasComment("打卡记录表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.TimeSlotId, "fk_checkins_time_slot");

            entity.HasIndex(e => e.IsDeleted, "idx_checkins_is_deleted");

            entity.HasIndex(e => new { e.PlanId, e.IsDeleted, e.CheckDate, e.TimeSlotId }, "idx_checkins_plan_deleted_date_slot");

            entity.HasIndex(e => e.Status, "idx_checkins_status");

            entity.HasIndex(e => new { e.UserId, e.CheckDate }, "idx_checkins_user_date");

            entity.HasIndex(e => new { e.PlanId, e.CheckDate, e.TimeSlotId }, "ux_checkins_plan_date_slot").IsUnique();

            entity.HasIndex(e => new { e.PlanId, e.CheckDate, e.TimeSlotIdKey }, "ux_checkins_plan_date_slot_key").IsUnique();

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.CheckDate)
                .HasComment("打卡日期（仅日期）")
                .HasColumnName("check_date");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.DeletedAt)
                .HasComment("伪删除时间")
                .HasColumnType("datetime")
                .HasColumnName("deleted_at");
            entity.Property(e => e.Images)
                .HasComment("打卡图片URL数组(JSON)")
                .HasColumnType("json")
                .HasColumnName("images");
            entity.Property(e => e.IsDeleted)
                .HasComment("是否伪删除：0正常，1已删除")
                .HasColumnName("is_deleted");
            entity.Property(e => e.Note)
                .HasComment("打卡备注")
                .HasColumnType("text")
                .HasColumnName("note");
            entity.Property(e => e.PlanId)
                .HasComment("所属打卡计划ID")
                .HasColumnName("plan_id");
            entity.Property(e => e.Status)
                .HasComment("打卡状态：0错过(红)、1成功(绿)、2补签(黄)")
                .HasColumnName("status");
            entity.Property(e => e.TimeSlotId)
                .HasComment("关联的打卡时间段ID")
                .HasColumnName("time_slot_id");
            entity.Property(e => e.TimeSlotIdKey)
                .HasComputedColumnSql("coalesce(`time_slot_id`,0)", true)
                .HasComment("Normalized time_slot_id for uniqueness")
                .HasColumnName("time_slot_id_key");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");
            entity.Property(e => e.UserId)
                .HasComment("打卡用户ID")
                .HasColumnName("user_id");

            entity.HasOne(d => d.Plan).WithMany(p => p.Checkins)
                .HasForeignKey(d => d.PlanId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("fk_checkins_plan");

            entity.HasOne(d => d.TimeSlot).WithMany(p => p.Checkins)
                .HasForeignKey(d => d.TimeSlotId)
                .HasConstraintName("fk_checkins_time_slot");

            entity.HasOne(d => d.User).WithMany(p => p.Checkins)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("fk_checkins_user");
        });

        modelBuilder.Entity<CheckinPlan>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("checkin_plans", tb => tb.HasComment("打卡计划表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.IsActive, "idx_plans_is_active");

            entity.HasIndex(e => e.IsDeleted, "idx_plans_is_deleted");

            entity.HasIndex(e => e.StartDate, "idx_plans_start_date");

            entity.HasIndex(e => e.UserId, "idx_plans_user");

            entity.HasIndex(e => new { e.UserId, e.IsDeleted, e.StartDate }, "idx_plans_user_deleted_start");

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.CheckinMode)
                .HasComment("打卡模式：0-默认模式，1-时间段打卡模式")
                .HasColumnName("checkin_mode");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.DeletedAt)
                .HasComment("伪删除时间")
                .HasColumnType("datetime")
                .HasColumnName("deleted_at");
            entity.Property(e => e.Description)
                .HasComment("打卡计划描述")
                .HasColumnType("text")
                .HasColumnName("description");
            entity.Property(e => e.EndDate)
                .HasComment("计划结束日期（可选）")
                .HasColumnName("end_date");
            entity.Property(e => e.IsActive)
                .IsRequired()
                .HasDefaultValueSql("'1'")
                .HasComment("是否启用：1启用，0停用")
                .HasColumnName("is_active");
            entity.Property(e => e.IsDeleted)
                .HasComment("是否伪删除：0正常，1已删除")
                .HasColumnName("is_deleted");
            entity.Property(e => e.StartDate)
                .HasComment("计划开始日期")
                .HasColumnName("start_date");
            entity.Property(e => e.Title)
                .HasMaxLength(255)
                .HasComment("打卡计划标题")
                .HasColumnName("title");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");
            entity.Property(e => e.UserId)
                .HasComment("计划所属用户ID")
                .HasColumnName("user_id");

            entity.HasOne(d => d.User).WithMany(p => p.CheckinPlans)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("fk_plans_user");
        });

        modelBuilder.Entity<CheckinPlanTimeSlot>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("checkin_plan_time_slots", tb => tb.HasComment("打卡计划时间段配置表（每日重复）"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.IsActive, "idx_slots_active");

            entity.HasIndex(e => e.PlanId, "idx_slots_plan");

            entity.HasIndex(e => new { e.PlanId, e.IsActive, e.OrderNum, e.StartTime }, "idx_slots_plan_active_order");

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.EndTime)
                .HasComment("结束时间（如 10:00:00）")
                .HasColumnType("time")
                .HasColumnName("end_time");
            entity.Property(e => e.IsActive)
                .IsRequired()
                .HasDefaultValueSql("'1'")
                .HasComment("是否启用：1启用，0停用")
                .HasColumnName("is_active");
            entity.Property(e => e.OrderNum)
                .HasComment("排序序号，用于界面展示顺序")
                .HasColumnName("order_num");
            entity.Property(e => e.PlanId)
                .HasComment("所属打卡计划ID")
                .HasColumnName("plan_id");
            entity.Property(e => e.SlotName)
                .HasMaxLength(64)
                .HasComment("时间段名称，如“早晨”、“下午”")
                .HasColumnName("slot_name");
            entity.Property(e => e.StartTime)
                .HasComment("开始时间（如 09:00:00）")
                .HasColumnType("time")
                .HasColumnName("start_time");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Plan).WithMany(p => p.CheckinPlanTimeSlots)
                .HasForeignKey(d => d.PlanId)
                .HasConstraintName("fk_slots_plan");
        });

        modelBuilder.Entity<Efmigrationshistory>(entity =>
        {
            entity.HasKey(e => e.MigrationId).HasName("PRIMARY");

            entity.ToTable("__efmigrationshistory");

            entity.Property(e => e.MigrationId).HasMaxLength(150);
            entity.Property(e => e.ProductVersion).HasMaxLength(32);
        });

        modelBuilder.Entity<SoftDeleteLog>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("soft_delete_logs", tb => tb.HasComment("伪删除操作日志表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.DeleterUserId, "fk_soft_delete_deleter");

            entity.HasIndex(e => e.DeletedAt, "idx_soft_delete_deleted_at");

            entity.HasIndex(e => new { e.TableName, e.RecordId }, "idx_soft_delete_table_record");

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.DeletedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("伪删除时间")
                .HasColumnType("datetime")
                .HasColumnName("deleted_at");
            entity.Property(e => e.DeleterUserId)
                .HasComment("执行伪删除操作的用户ID")
                .HasColumnName("deleter_user_id");
            entity.Property(e => e.Extra)
                .HasComment("扩展信息(JSON)，如数据快照等")
                .HasColumnType("json")
                .HasColumnName("extra");
            entity.Property(e => e.Reason)
                .HasMaxLength(255)
                .HasComment("伪删除原因")
                .HasColumnName("reason");
            entity.Property(e => e.RecordId)
                .HasComment("被伪删除记录的主键ID")
                .HasColumnName("record_id");
            entity.Property(e => e.TableName)
                .HasMaxLength(64)
                .HasComment("伪删除记录所属表名")
                .HasColumnName("table_name");

            entity.HasOne(d => d.DeleterUser).WithMany(p => p.SoftDeleteLogs)
                .HasForeignKey(d => d.DeleterUserId)
                .HasConstraintName("fk_soft_delete_deleter");
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("users", tb => tb.HasComment("用户表（支持伪删除与黑名单冻结）"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.FreezeOperatorId, "fk_users_freeze_operator");

            entity.HasIndex(e => e.FrozenAt, "idx_users_frozen_at");

            entity.HasIndex(e => e.IsDeleted, "idx_users_is_deleted");

            entity.HasIndex(e => e.Status, "idx_users_status");

            entity.HasIndex(e => e.Email, "ux_users_email").IsUnique();

            entity.HasIndex(e => e.UserAccount, "ux_users_user_account").IsUnique();

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.AccountUpdatedAt)
                .HasComment("username更新时间")
                .HasColumnType("datetime")
                .HasColumnName("account_updated_at");
            entity.Property(e => e.AvatarKey)
                .HasMaxLength(512)
                .HasComment("头像图片URL")
                .HasColumnName("avatar_key");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.DeletedAt)
                .HasComment("伪删除时间")
                .HasColumnType("datetime")
                .HasColumnName("deleted_at");
            entity.Property(e => e.Email)
                .HasComment("用户邮箱（唯一）")
                .HasColumnName("email");
            entity.Property(e => e.FreezeOperatorId)
                .HasComment("执行冻结操作的管理员用户ID")
                .HasColumnName("freeze_operator_id");
            entity.Property(e => e.FrozenAt)
                .HasComment("账户冻结时间")
                .HasColumnType("datetime")
                .HasColumnName("frozen_at");
            entity.Property(e => e.FrozenReason)
                .HasMaxLength(255)
                .HasComment("账户冻结原因")
                .HasColumnName("frozen_reason");
            entity.Property(e => e.IsDeleted)
                .HasComment("是否伪删除：0正常，1已删除")
                .HasColumnName("is_deleted");
            entity.Property(e => e.NickName)
                .HasMaxLength(64)
                .HasComment("用户昵称")
                .HasColumnName("nick_name");
            entity.Property(e => e.PasswordHash)
                .HasMaxLength(255)
                .HasComment("密码哈希（如bcrypt）")
                .HasColumnName("password_hash");
            entity.Property(e => e.Role)
                .HasDefaultValueSql("'user'")
                .HasComment("用户角色：user普通用户，admin管理员")
                .HasColumnType("enum('user','admin')")
                .HasColumnName("role");
            entity.Property(e => e.Status)
                .IsRequired()
                .HasDefaultValueSql("'1'")
                .HasComment("账户状态：1正常，0冻结")
                .HasColumnName("status");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");
            entity.Property(e => e.UserAccount)
                .HasMaxLength(64)
                .HasComment("用户账号（唯一）")
                .HasColumnName("user_account");

            entity.HasOne(d => d.FreezeOperator).WithMany(p => p.InverseFreezeOperator)
                .HasForeignKey(d => d.FreezeOperatorId)
                .HasConstraintName("fk_users_freeze_operator");
        });

        modelBuilder.Entity<UserActivity>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("user_activity", tb => tb.HasComment("用户行为埋点日志表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.CreatedAt, "idx_activity_created");

            entity.HasIndex(e => new { e.UserId, e.CreatedAt }, "idx_activity_user_created");

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.Action)
                .HasMaxLength(64)
                .HasComment("操作名称/事件标识")
                .HasColumnName("action");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("记录时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.Ip)
                .HasMaxLength(45)
                .HasComment("IP地址")
                .HasColumnName("ip");
            entity.Property(e => e.Metadata)
                .HasComment("扩展元数据(JSON)，参数等")
                .HasColumnType("json")
                .HasColumnName("metadata");
            entity.Property(e => e.Path)
                .HasMaxLength(255)
                .HasComment("页面路径或操作路径")
                .HasColumnName("path");
            entity.Property(e => e.UserAgent)
                .HasMaxLength(512)
                .HasComment("User-Agent信息")
                .HasColumnName("user_agent");
            entity.Property(e => e.UserId)
                .HasComment("用户ID（匿名操作可为空）")
                .HasColumnName("user_id");
        });

        modelBuilder.Entity<UserBlock>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("user_blocks", tb => tb.HasComment("用户拉黑关系表（按拉黑方方向存储）"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.BlockedUserId, "idx_user_blocks_blocked");

            entity.HasIndex(e => new { e.UserId, e.BlockedUserId }, "ux_user_blocks_user_blocked").IsUnique();

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.BlockedUserId)
                .HasComment("被拉黑用户ID")
                .HasColumnName("blocked_user_id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("拉黑时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");
            entity.Property(e => e.UserId)
                .HasComment("拉黑方用户ID")
                .HasColumnName("user_id");

            entity.HasOne(d => d.BlockedUser).WithMany()
                .HasForeignKey(d => d.BlockedUserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_user_blocks_blocked");

            entity.HasOne(d => d.User).WithMany()
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.Cascade)
                .HasConstraintName("fk_user_blocks_user");
        });

        modelBuilder.Entity<UserBlacklistRecord>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("user_blacklist_records", tb => tb.HasComment("用户黑名单记录表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.OperatorUserId, "fk_blacklist_operator");

            entity.HasIndex(e => new { e.UserId, e.OccurredAt }, "idx_blacklist_user");

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.OccurredAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("操作发生时间")
                .HasColumnType("datetime")
                .HasColumnName("occurred_at");
            entity.Property(e => e.OperatorUserId)
                .HasComment("执行操作的管理员用户ID")
                .HasColumnName("operator_user_id");
            entity.Property(e => e.Reason)
                .HasMaxLength(255)
                .HasComment("拉黑或解封原因")
                .HasColumnName("reason");
            entity.Property(e => e.Status)
                .HasComment("状态：1拉黑，0解封（历史记录）")
                .HasColumnName("status");
            entity.Property(e => e.UserId)
                .HasComment("被拉黑的用户ID")
                .HasColumnName("user_id");

            entity.HasOne(d => d.OperatorUser).WithMany(p => p.UserBlacklistRecordOperatorUsers)
                .HasForeignKey(d => d.OperatorUserId)
                .HasConstraintName("fk_blacklist_operator");

            entity.HasOne(d => d.User).WithMany(p => p.UserBlacklistRecordUsers)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("fk_blacklist_user");
        });

        modelBuilder.Entity<UserFriendRequest>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("user_friend_requests", tb => tb.HasComment("好友请求表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.HandledByUserId, "idx_friend_requests_handled_by");

            entity.HasIndex(e => new { e.RequesterUserId, e.ReceiverUserId, e.RequestStatus }, "idx_friend_requests_pair_status");

            entity.HasIndex(e => new { e.ReceiverUserId, e.RequestStatus, e.CreatedAt }, "idx_friend_requests_receiver_status");

            entity.HasIndex(e => new { e.RequesterUserId, e.RequestStatus, e.CreatedAt }, "idx_friend_requests_requester_status");

            entity.HasIndex(e => e.SourceConversationId, "idx_friend_requests_source_conversation");

            entity.HasIndex(e => new { e.RequestStatus, e.ExpireAt }, "idx_friend_requests_status_expire");

            entity.Property(e => e.Id)
                .HasComment("主键")
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.ExpireAt)
                .HasComment("过期时间")
                .HasColumnType("datetime")
                .HasColumnName("expire_at");
            entity.Property(e => e.HandledAt)
                .HasComment("处理时间")
                .HasColumnType("datetime")
                .HasColumnName("handled_at");
            entity.Property(e => e.HandledByUserId)
                .HasComment("处理者用户ID")
                .HasColumnName("handled_by_user_id");
            entity.Property(e => e.ReceiverUserId)
                .HasComment("接收者用户ID")
                .HasColumnName("receiver_user_id");
            entity.Property(e => e.RejectReason)
                .HasMaxLength(255)
                .HasComment("拒绝原因")
                .HasColumnName("reject_reason");
            entity.Property(e => e.RequestMessage)
                .HasMaxLength(255)
                .HasComment("请求消息")
                .HasColumnName("request_message");
            entity.Property(e => e.RequestSource)
                .HasDefaultValueSql("'account'")
                .HasComment("请求来源（account-账号/group-群组/search-搜索/system-系统）")
                .HasColumnType("enum('account','group','search','system')")
                .HasColumnName("request_source");
            entity.Property(e => e.RequestStatus)
                .HasDefaultValueSql("'pending'")
                .HasComment("请求状态（pending-待处理/accepted-已接受/rejected-已拒绝/cancelled-已取消/expired-已过期）")
                .HasColumnType("enum('pending','accepted','rejected','cancelled','expired')")
                .HasColumnName("request_status");
            entity.Property(e => e.RequesterUserId)
                .HasComment("请求者用户ID")
                .HasColumnName("requester_user_id");
            entity.Property(e => e.SourceConversationId)
                .HasComment("来源群组会话ID")
                .HasColumnName("source_conversation_id");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.HandledByUser).WithMany(p => p.UserFriendRequestHandledByUsers)
                .HasForeignKey(d => d.HandledByUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_friend_requests_handled_by");

            entity.HasOne(d => d.ReceiverUser).WithMany(p => p.UserFriendRequestReceiverUsers)
                .HasForeignKey(d => d.ReceiverUserId)
                .HasConstraintName("fk_friend_requests_receiver");

            entity.HasOne(d => d.RequesterUser).WithMany(p => p.UserFriendRequestRequesterUsers)
                .HasForeignKey(d => d.RequesterUserId)
                .HasConstraintName("fk_friend_requests_requester");

            entity.HasOne(d => d.SourceConversation).WithMany(p => p.UserFriendRequests)
                .HasForeignKey(d => d.SourceConversationId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_friend_requests_source_conversation");
        });

        modelBuilder.Entity<UserFriendship>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("user_friendships", tb => tb.HasComment("好友关系表（按用户方向存储）"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.CreatedByUserId, "idx_friendships_created_by");

            entity.HasIndex(e => e.DeletedByUserId, "idx_friendships_deleted_by");

            entity.HasIndex(e => new { e.FriendUserId, e.Status }, "idx_friendships_friend_status");

            entity.HasIndex(e => e.SourceConversationId, "idx_friendships_source_conversation");

            entity.HasIndex(e => e.SourceRequestId, "idx_friendships_source_request");

            entity.HasIndex(e => new { e.UserId, e.Status }, "idx_friendships_user_status");

            entity.HasIndex(e => new { e.UserId, e.Status, e.IsStarred, e.AcceptedAt, e.CreatedAt }, "idx_friendships_user_status_order").IsDescending(false, false, true, true, true);

            entity.HasIndex(e => new { e.UserId, e.FriendUserId }, "ux_friendships_user_friend").IsUnique();

            entity.Property(e => e.Id)
                .HasComment("主键")
                .HasColumnName("id");
            entity.Property(e => e.AcceptedAt)
                .HasComment("接受时间")
                .HasColumnType("datetime")
                .HasColumnName("accepted_at");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.CreatedByUserId)
                .HasComment("创建关系的操作者用户ID")
                .HasColumnName("created_by_user_id");
            entity.Property(e => e.DeletedAt)
                .HasComment("删除时间")
                .HasColumnType("datetime")
                .HasColumnName("deleted_at");
            entity.Property(e => e.DeletedByUserId)
                .HasComment("删除关系的操作者用户ID")
                .HasColumnName("deleted_by_user_id");
            entity.Property(e => e.FriendRemark)
                .HasMaxLength(64)
                .HasComment("好友备注")
                .HasColumnName("friend_remark");
            entity.Property(e => e.FriendUserId)
                .HasComment("好友用户ID")
                .HasColumnName("friend_user_id");
            entity.Property(e => e.IsMuted)
                .HasComment("是否静音（0-否/1-是）")
                .HasColumnName("is_muted");
            entity.Property(e => e.IsStarred)
                .HasComment("是否置顶（0-否/1-是）")
                .HasColumnName("is_starred");
            entity.Property(e => e.SourceConversationId)
                .HasComment("来源群组会话ID")
                .HasColumnName("source_conversation_id");
            entity.Property(e => e.SourceRequestId)
                .HasComment("来源好友请求ID")
                .HasColumnName("source_request_id");
            entity.Property(e => e.Status)
                .HasDefaultValueSql("'active'")
                .HasComment("好友关系状态（active-活跃/deleted-已删除）")
                .HasColumnType("enum('active','deleted')")
                .HasColumnName("status");
            entity.Property(e => e.UpdatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");
            entity.Property(e => e.UserId)
                .HasComment("用户ID")
                .HasColumnName("user_id");

            entity.HasOne(d => d.CreatedByUser).WithMany(p => p.UserFriendshipCreatedByUsers)
                .HasForeignKey(d => d.CreatedByUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_friendships_created_by");

            entity.HasOne(d => d.DeletedByUser).WithMany(p => p.UserFriendshipDeletedByUsers)
                .HasForeignKey(d => d.DeletedByUserId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_friendships_deleted_by");

            entity.HasOne(d => d.FriendUser).WithMany(p => p.UserFriendshipFriendUsers)
                .HasForeignKey(d => d.FriendUserId)
                .HasConstraintName("fk_friendships_friend");

            entity.HasOne(d => d.SourceConversation).WithMany(p => p.UserFriendships)
                .HasForeignKey(d => d.SourceConversationId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_friendships_source_conversation");

            entity.HasOne(d => d.SourceRequest).WithMany(p => p.UserFriendships)
                .HasForeignKey(d => d.SourceRequestId)
                .OnDelete(DeleteBehavior.SetNull)
                .HasConstraintName("fk_friendships_source_request");

            entity.HasOne(d => d.User).WithMany(p => p.UserFriendshipUsers)
                .HasForeignKey(d => d.UserId)
                .HasConstraintName("fk_friendships_user");
        });

        modelBuilder.Entity<UserOauthAccount>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("user_oauth_accounts", tb => tb.HasComment("用户第三方登录账号绑定表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.UnionId, "idx_oauth_union_id");

            entity.HasIndex(e => e.UserId, "idx_oauth_user");

            entity.HasIndex(e => new { e.Provider, e.OpenId }, "ux_oauth_provider_open").IsUnique();

            entity.HasIndex(e => new { e.Provider, e.UnionId }, "ux_oauth_provider_union").IsUnique();

            entity.Property(e => e.Id)
                .HasComment("主键ID")
                .HasColumnName("id");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("绑定时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.OpenId)
                .HasComment("第三方平台open_id")
                .HasColumnName("open_id");
            entity.Property(e => e.Provider)
                .HasComment("第三方登录平台类型")
                .HasColumnType("enum('wechat','google','apple')")
                .HasColumnName("provider");
            entity.Property(e => e.UnionId)
                .HasComment("第三方平台union_id（可选）")
                .HasColumnName("union_id");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");
            entity.Property(e => e.UserId)
                .HasComment("关联用户ID")
                .HasColumnName("user_id");

            entity.HasOne(d => d.User).WithMany(p => p.UserOauthAccounts)
                .HasForeignKey(d => d.UserId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("fk_oauth_user");
        });

        OnModelCreatingPartial(modelBuilder);
    }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder);
}
