using System.Security.Claims;
using api.Data;
using api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace api.Hubs;

/// <summary>
/// 聊天 Hub，处理实时通信功能。
/// </summary>
[Authorize]
public class ChatHub(DailyCheckDbContext db) : Hub
{
    readonly DailyCheckDbContext _db = db;

    /// <summary>
    /// 连接建立时自动加入的会话上限，避免会话极多的账号产生过大的分组扇出。
    /// </summary>
    const int MaxAutoSubscribedConversations = 200;

    public override async Task OnConnectedAsync()
    {
        var userId = GetUserId();
        await Groups.AddToGroupAsync(Context.ConnectionId, UserGroupName(userId));

        // 连接建立时直接把用户加入其所有会话分组。
        // 旧实现只在客户端显式调用 SubscribeConversation 后才入组，
        // 断线重连（组是按 ConnectionId 记的，重连即失效）或客户端订阅失败时，
        // 会话内的消息事件根本不会送到这个连接，表现为「收消息不及时、要手动刷新」。
        var conversationIds = await _db.ChatConversationMembers
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.LeftAt == null)
            .OrderByDescending(m => m.ConversationId)
            .Select(m => m.ConversationId)
            .Take(MaxAutoSubscribedConversations)
            .ToListAsync();

        foreach (var conversationId in conversationIds)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(conversationId));
        }

        await base.OnConnectedAsync();
    }

    /// <summary>
    /// 订阅指定的会话以接收实时消息。
    /// </summary>
    /// <param name="conversationId">会话 ID。</param>
    public async Task SubscribeConversation(ulong conversationId)
    {
        var userId = GetUserId();
        var isMember = await _db.ChatConversationMembers
            .AnyAsync(m => m.ConversationId == conversationId && m.UserId == userId && m.LeftAt == null);
        if (!isMember)
            throw new HubException("会话不存在或无权限订阅");

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(conversationId));
    }

    /// <summary>
    /// 取消订阅指定的会话。
    /// </summary>
    /// <param name="conversationId">会话 ID。</param>
    public async Task UnsubscribeConversation(ulong conversationId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(conversationId));
    }

    /// <summary>
    /// 标记消息为已读并广播给会话成员。
    /// </summary>
    /// <param name="conversationId">会话 ID。</param>
    /// <param name="messageId">消息 ID。</param>
    public async Task MarkMessageRead(ulong conversationId, ulong messageId)
    {
        var userId = GetUserId();
        var now = DateTime.UtcNow;

        var membership = await _db.ChatConversationMembers
            .SingleOrDefaultAsync(m => m.ConversationId == conversationId
                                    && m.UserId == userId
                                    && m.LeftAt == null);
        if (membership == null)
            throw new HubException("无权限操作");

        var message = await _db.ChatMessages
            .FirstOrDefaultAsync(m => m.Id == messageId && m.ConversationId == conversationId);
        if (message == null || message.SenderUserId == userId)
            return;

        var existing = await _db.ChatMessageReceipts
            .AnyAsync(r => r.MessageId == messageId && r.UserId == userId);
        if (existing)
            return;

        _db.ChatMessageReceipts.Add(new ChatMessageReceipt
        {
            MessageId = messageId,
            UserId = userId,
            ReadAt = now
        });

        if (messageId > (membership.LastReadMessageId ?? 0))
        {
            membership.LastReadMessageId = messageId;
            membership.UpdatedAt = now;
        }

        await _db.SaveChangesAsync();

        await Clients.Group(GroupName(conversationId)).SendAsync("chat:message-read", new
        {
            messageId,
            conversationId,
            readByUserId = userId,
            readAt = now
        });

        await NotifyConversationInboxUpdated(conversationId, now);
    }

    /// <summary>
    /// 获取消息的已读详情。
    /// </summary>
    /// <param name="messageId">消息 ID。</param>
    /// <returns>消息已读详情。</returns>
    public async Task<MessageReadDetailDto> GetMessageReadDetail(ulong messageId)
    {
        var userId = GetUserId();

        var message = await _db.ChatMessages
            .Include(m => m.Conversation)
            .FirstOrDefaultAsync(m => m.Id == messageId);
        if (message == null)
            throw new HubException("消息不存在");

        var isMember = await _db.ChatConversationMembers
            .AnyAsync(m => m.ConversationId == message.ConversationId
                        && m.UserId == userId
                        && m.LeftAt == null);
        if (!isMember)
            throw new HubException("无权限查看");

        var readUsers = await _db.ChatMessageReceipts
            .Where(r => r.MessageId == messageId)
            .Join(_db.Users,
                r => r.UserId,
                u => u.Id,
                (r, u) => new ReadUserDto
                {
                    UserId = u.Id,
                    NickName = u.NickName ?? u.UserAccount ?? string.Empty,
                    AvatarKey = u.AvatarKey,
                    ReadAt = r.ReadAt
                })
            .ToListAsync();

        return new MessageReadDetailDto
        {
            MessageId = messageId,
            TotalRecipients = await _db.ChatConversationMembers
                .CountAsync(m => m.ConversationId == message.ConversationId
                              && m.UserId != message.SenderUserId
                              && m.LeftAt == null),
            ReadCount = readUsers.Count,
            ReadUsers = readUsers
        };
    }

    /// <summary>
    /// 生成会话群组名称。
    /// </summary>
    /// <param name="conversationId">会话 ID。</param>
    /// <returns>群组名称。</returns>
    public static string GroupName(ulong conversationId) => $"conversation-{conversationId}";

    public static string UserGroupName(ulong userId) => $"user-{userId}";

    async Task NotifyConversationInboxUpdated(ulong conversationId, DateTime updatedAt)
    {
        var memberUserIds = await _db.ChatConversationMembers
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId && m.LeftAt == null)
            .Select(m => m.UserId)
            .Distinct()
            .ToListAsync();

        if (memberUserIds.Count == 0)
            return;

        await Clients.Groups(memberUserIds.Select(UserGroupName).ToList()).SendAsync("chat:inbox-updated", new
        {
            conversationId,
            updatedAt
        });
    }

    /// <summary>
    /// 获取当前用户 ID。
    /// </summary>
    /// <returns>用户 ID。</returns>
    ulong GetUserId()
    {
        var candidateTypes = new[] { ClaimTypes.NameIdentifier, "sub", "nameid", "user_id", "id" };

        foreach (var type in candidateTypes)
        {
            var val = Context.User?.FindFirstValue(type);
            if (!string.IsNullOrEmpty(val))
            {
                if (ulong.TryParse(val, out var id))
                    return id;

                throw new HubException($"无法解析用户 ID：claim '{type}' 的值为 '{val}'，不是有效的 ulong。");
            }
        }

        throw new HubException("在令牌中未找到用户 ID。");
    }
}
