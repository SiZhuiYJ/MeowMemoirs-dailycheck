
using api.Data;
using api.Hubs;
using api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.Tasks;

namespace api.Controllers;

/// <summary>
/// 聊天会话与消息管理接口。
/// 提供创建会话、发送消息、获取历史记录、成员管理（邀请、踢人、禁言）、群申请处理等功能。
/// 支持单聊和群聊两种模式，集成 SignalR 实现实时消息推送。
/// </summary>
[ApiController]
[Route("mm/[controller]")]
[Authorize]
public class ChatController(DailyCheckDbContext db, IHubContext<ChatHub> hubContext) : ControllerBase
{
    readonly DailyCheckDbContext _db = db;
    readonly IHubContext<ChatHub> _hubContext = hubContext;
    static readonly HashSet<string> AllowedMessageTypes = new(["text", "image", "video", "audio", "file", "system"]);

    /// <summary>
    /// 创建新的聊天会话（单聊或群聊）。
    /// 单聊需确保双方已是好友关系；群聊需确保所有初始成员均为发起人的好友。
    /// 若已存在活跃的单聊会话，则直接返回该会话详情。
    /// </summary>
    /// <param name="request">创建会话请求参数，包含会话类型、标题、头像及成员列表。</param>
    /// <returns>创建成功的会话详细信息。</returns>
    [HttpPost("conversations")]
    public async Task<ActionResult<ConversationDetailDto>> CreateConversation(CreateConversationRequest request)
    {
        var userId = GetUserId();
        var conversationType = (request.ConversationType ?? string.Empty).Trim().ToLowerInvariant();
        if (conversationType is not ("direct" or "group"))
            return BadRequest(new { message = "conversationType 娴犲懏鏁幐?direct 閹?group" });

        var memberIds = request.MemberUserIds
            .Append(userId)
            .Distinct()
            .ToList();

        if (conversationType == "direct" && memberIds.Count != 2)
            return BadRequest(new { message = "Direct conversations must include exactly 2 users" });

        if (conversationType == "group" && memberIds.Count < 2)
            return BadRequest(new { message = "Group conversations must include at least 2 users" });

        var validUserIds = await _db.Users
            .Where(x => memberIds.Contains(x.Id) && !x.IsDeleted && x.Status == true)
            .Select(x => x.Id)
            .ToListAsync();

        if (validUserIds.Count != memberIds.Count)
            return BadRequest(new { message = "One or more members are invalid, deleted, or disabled" });

        var targetMemberUserIds = memberIds
            .Where(x => x != userId)
            .ToList();

        if (conversationType == "direct")
        {
            var peerUserId = targetMemberUserIds.Single();
            if (await IsBlockedBy(peerUserId, userId))
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { message = "对方已将你拉黑，无法发起聊天" });

            if (!await AreUsersFriends(userId, peerUserId))
                return BadRequest(new { message = "Direct conversations can only be started with users who are already your friends" });

            var existingDirect = await _db.ChatConversations
                .Where(c => c.ConversationType == "direct" && c.IsActive == true)
                .Where(c => c.ChatConversationMembers.Any(m => m.UserId == userId && m.LeftAt == null))
                .Where(c => c.ChatConversationMembers.Any(m => m.UserId == peerUserId && m.LeftAt == null))
                .Where(c => c.ChatConversationMembers.Count(m => m.LeftAt == null) == 2)
                .Select(c => c.Id)
                .FirstOrDefaultAsync();

            if (existingDirect != 0)
            {
                return Ok(await BuildConversationDetail(existingDirect, userId));
            }
        }
        else
        {
            var friendUserIds = await GetActiveFriendUserIds(userId, targetMemberUserIds);
            if (friendUserIds.Count != targetMemberUserIds.Count)
                return BadRequest(new { message = "Group conversations can only include your friends when they are created" });
        }

        var now = DateTime.UtcNow;
        var conversation = new ChatConversation
        {
            ConversationType = conversationType,
            Title = conversationType == "group" ? request.Title : null,
            AvatarKey = request.AvatarKey,
            OwnerUserId = conversationType == "group" ? userId : null,
            IsActive = true,
            ConversationStatus = "active",
            MemberLimit = 500,
            LastMessageAt = null,
            CreatedAt = now,
            UpdatedAt = now
        };

        foreach (var memberUserId in memberIds)
        {
            conversation.ChatConversationMembers.Add(new ChatConversationMember
            {
                UserId = memberUserId,
                MemberRole = conversationType == "group" && memberUserId == userId ? "owner" : "member",
                MembershipStatus = "active",
                JoinedAt = now,
                InvitedAt = memberUserId == userId ? null : now,
                InvitedByUserId = memberUserId == userId ? null : userId,
                IsMuted = false,
                IsPinned = false,
                CreatedAt = now,
                UpdatedAt = now
            });
        }

        _db.ChatConversations.Add(conversation);
        await _db.SaveChangesAsync();
        await NotifyConversationInboxUpdated(conversation.Id);

        var detail = await BuildConversationDetail(conversation.Id, userId);
        return CreatedAtAction(nameof(GetConversationById), new { conversationId = conversation.Id }, detail);
    }

    /// <summary>
    /// 鏇存柊缇ゆ垚鍛樿鑹?
    /// </summary>
    [HttpPost("conversations/{conversationId:ulong}/members/{memberUserId:ulong}/role")]
    public async Task<ActionResult<ConversationDetailDto>> UpdateConversationMemberRole(
        ulong conversationId,
        ulong memberUserId,
        UpdateConversationMemberRoleRequest request)
    {
        var userId = GetUserId();
        var conversation = await _db.ChatConversations
            .Include(c => c.ChatConversationMembers)
            .FirstOrDefaultAsync(c => c.Id == conversationId && c.IsActive == true);

        if (conversation == null)
            return NotFound(new { message = "Conversation not found" });

        if (conversation.ConversationType != "group")
            return BadRequest(new { message = "Only group conversations support member role management" });

        var currentMember = conversation.ChatConversationMembers
            .FirstOrDefault(m => m.UserId == userId && m.LeftAt == null);
        if (currentMember == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var currentRole = (currentMember.MemberRole ?? string.Empty).Trim().ToLowerInvariant();
        if (currentRole != "owner")
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Only the owner can update member roles" });

        var targetMember = conversation.ChatConversationMembers
            .FirstOrDefault(m => m.UserId == memberUserId && m.LeftAt == null);
        if (targetMember == null)
            return NotFound(new { message = "Target member not found" });

        if (targetMember.UserId == userId)
            return BadRequest(new { message = "Cannot change your own group role" });

        var targetRole = (targetMember.MemberRole ?? string.Empty).Trim().ToLowerInvariant();
        if (targetRole == "owner")
            return BadRequest(new { message = "Cannot change the owner role" });

        var nextRole = (request.MemberRole ?? string.Empty).Trim().ToLowerInvariant();
        if (nextRole is not ("admin" or "member"))
            return BadRequest(new { message = "memberRole only supports admin or member" });

        if (targetRole == nextRole)
        {
            var unchangedDetail = await BuildConversationDetail(conversationId, userId);
            return unchangedDetail == null
                ? NotFound(new { message = "Conversation not found" })
                : Ok(unchangedDetail);
        }

        var now = DateTime.UtcNow;
        targetMember.MemberRole = nextRole;
        targetMember.UpdatedAt = now;
        conversation.UpdatedAt = now;

        await _db.SaveChangesAsync();
        var updatedDetail = await BuildConversationDetail(conversationId, userId);
        return updatedDetail == null ? NotFound(new { message = "Conversation not found" }) : Ok(updatedDetail);
    }

    [HttpPost("conversations/{conversationId:ulong}/members/invite")]
    public async Task<ActionResult<ConversationDetailDto>> InviteConversationMembers(
        ulong conversationId,
        InviteConversationMembersRequest request)
    {
        var userId = GetUserId();
        var context = await GetActiveConversationContext(conversationId, userId);
        if (context == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var (conversation, currentMember) = context.Value;
        if (conversation.ConversationType != "group")
            return BadRequest(new { message = "Only group conversations support inviting members" });

        var memberUserIds = request.MemberUserIds
            .Where(id => id != 0 && id != userId)
            .Distinct()
            .ToList();

        if (memberUserIds.Count == 0)
            return BadRequest(new { message = "memberUserIds must contain at least one valid user" });

        var targetUsers = await _db.Users
            .Where(u => memberUserIds.Contains(u.Id) && !u.IsDeleted && u.Status == true)
            .ToListAsync();

        if (targetUsers.Count != memberUserIds.Count)
            return BadRequest(new { message = "One or more invited users are invalid, deleted, or disabled" });

        var friendUserIds = await GetActiveFriendUserIds(userId, memberUserIds);
        if (friendUserIds.Count != memberUserIds.Count)
            return BadRequest(new { message = "Group members can only invite their own friends" });

        var membersByUserId = conversation.ChatConversationMembers.ToDictionary(m => m.UserId);
        var rejoinCount = memberUserIds.Count(userIdItem =>
            !membersByUserId.TryGetValue(userIdItem, out var member) || member.LeftAt != null);
        var activeMemberCount = conversation.ChatConversationMembers.Count(m => m.LeftAt == null);
        var memberLimit = conversation.MemberLimit == 0
            ? int.MaxValue
            : (int)Math.Min(conversation.MemberLimit, int.MaxValue);

        if (activeMemberCount + rejoinCount > memberLimit)
            return BadRequest(new { message = "Inviting these users would exceed the group member limit" });

        var now = DateTime.UtcNow;
        var invitedNames = new List<string>();

        foreach (var targetUser in targetUsers)
        {
            if (membersByUserId.TryGetValue(targetUser.Id, out var existingMember))
            {
                if (existingMember.LeftAt == null)
                    continue;

                existingMember.MemberRole = "member";
                existingMember.MembershipStatus = "active";
                existingMember.JoinedAt = now;
                existingMember.InvitedAt = now;
                existingMember.InvitedByUserId = userId;
                existingMember.LeftAt = null;
                existingMember.RemovedByUserId = null;
                existingMember.RemovedReason = null;
                existingMember.MuteMode = null;
                existingMember.MuteUntil = null;
                existingMember.MuteReason = null;
                existingMember.MutedAt = null;
                existingMember.MutedByUserId = null;
                existingMember.UpdatedAt = now;
            }
            else
            {
                var newMember = new ChatConversationMember
                {
                    ConversationId = conversationId,
                    UserId = targetUser.Id,
                    MemberRole = "member",
                    MembershipStatus = "active",
                    JoinedAt = now,
                    InvitedAt = now,
                    InvitedByUserId = userId,
                    IsMuted = false,
                    IsPinned = false,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                conversation.ChatConversationMembers.Add(newMember);
                membersByUserId[targetUser.Id] = newMember;
            }

            invitedNames.Add(GetUserDisplayName(targetUser.NickName, targetUser.UserAccount, targetUser.Id));
            AddGroupActionLog(
                conversationId,
                "invite",
                userId,
                targetUser.Id,
                null,
                new
                {
                    invitedByUserId = userId
                });
        }

        if (invitedNames.Count == 0)
        {
            var unchangedDetail = await BuildConversationDetail(conversationId, userId);
            return unchangedDetail == null
                ? NotFound(new { message = "Conversation not found" })
                : Ok(unchangedDetail);
        }

        conversation.UpdatedAt = now;
        conversation.LastMessageAt = now;
        var operatorName = GetUserDisplayName(currentMember.User?.NickName, currentMember.User?.UserAccount, currentMember.UserId);
        var systemMessage = CreateSystemMessage(
            conversationId,
            userId,
            $"{operatorName} 邀请 {string.Join("、", invitedNames)} 加入了群聊",
            now);

        await _db.SaveChangesAsync();
        await BroadcastSystemMessage(systemMessage, now);

        var detail = await BuildConversationDetail(conversationId, userId);
        return detail == null ? NotFound(new { message = "Conversation not found" }) : Ok(detail);
    }

    [HttpPost("conversations/{conversationId:ulong}/join-requests")]
    public async Task<ActionResult<GroupJoinRequestDto>> CreateGroupJoinRequest(
        ulong conversationId,
        [FromBody] CreateGroupJoinRequestRequest? request = null)
    {
        var userId = GetUserId();
        await ExpirePendingGroupJoinRequests(conversationId);

        var conversation = await _db.ChatConversations
            .Include(c => c.ChatConversationMembers)
            .FirstOrDefaultAsync(c => c.Id == conversationId && c.IsActive == true);

        if (conversation == null || conversation.ConversationType != "group")
            return NotFound(new { message = "Group conversation not found or not available" });

        if (conversation.ChatConversationMembers.Any(m => m.UserId == userId && m.LeftAt == null))
            return BadRequest(new { message = "You are already a member of this group" });

        var existingPending = await _db.ChatGroupJoinRequests
            .FirstOrDefaultAsync(r =>
                r.ConversationId == conversationId &&
                r.RequesterUserId == userId &&
                r.RequestStatus == "pending" &&
                (r.ExpireAt == null || r.ExpireAt > DateTime.UtcNow));

        if (existingPending != null)
        {
            var existingDto = await BuildGroupJoinRequestDto(existingPending.Id);
            return existingDto == null
                ? BadRequest(new { message = "A pending join request already exists" })
                : Ok(existingDto);
        }

        var now = DateTime.UtcNow;
        var joinRequest = new ChatGroupJoinRequest
        {
            ConversationId = conversationId,
            RequesterUserId = userId,
            RequestMessage = NormalizeReason(request?.RequestMessage),
            RequestStatus = "pending",
            ExpireAt = now.AddDays(7),
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.ChatGroupJoinRequests.Add(joinRequest);
        await _db.SaveChangesAsync();

        var detail = await BuildGroupJoinRequestDto(joinRequest.Id);
        return detail == null
            ? BadRequest(new { message = "Join request was created but could not be loaded" })
            : Ok(detail);
    }

    [HttpGet("conversations/search")]
    public async Task<ActionResult<GroupSearchResultDto?>> SearchGroupConversation([FromQuery] ulong conversationId)
    {
        if (conversationId == 0)
            return BadRequest(new { message = "conversationId must be greater than 0" });

        var userId = GetUserId();
        await ExpirePendingGroupJoinRequests(conversationId);

        var now = DateTime.UtcNow;
        var result = await _db.ChatConversations
            .AsNoTracking()
            .Where(c =>
                c.Id == conversationId &&
                c.IsActive == true &&
                c.ConversationType == "group")
            .Select(c => new GroupSearchResultDto
            {
                Id = c.Id,
                ConversationType = c.ConversationType,
                Title = c.Title,
                AvatarKey = c.AvatarKey,
                OwnerUserId = c.OwnerUserId,
                MemberCount = c.ChatConversationMembers.Count(m => m.LeftAt == null),
                IsMember = c.ChatConversationMembers.Any(m => m.UserId == userId && m.LeftAt == null),
                HasPendingJoinRequest = c.ChatGroupJoinRequests.Any(r =>
                    r.RequesterUserId == userId &&
                    r.RequestStatus == "pending" &&
                    (r.ExpireAt == null || r.ExpireAt > now))
            })
            .SingleOrDefaultAsync();

        return Ok(result);
    }

    [HttpGet("conversations/{conversationId:ulong}/join-requests")]
    public async Task<ActionResult<List<GroupJoinRequestDto>>> GetGroupJoinRequests(
        ulong conversationId,
        [FromQuery] string? status = null)
    {
        var userId = GetUserId();
        await ExpirePendingGroupJoinRequests(conversationId);

        var context = await GetActiveConversationContext(conversationId, userId);
        if (context == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var (conversation, currentMember) = context.Value;
        if (conversation.ConversationType != "group")
            return BadRequest(new { message = "Only group conversations support join requests" });

        if (!CanManageJoinRequests(currentMember))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Only the owner or an admin can view join requests" });

        var normalizedStatus = NormalizeGroupJoinRequestStatus(status) ?? "pending";
        var requests = await _db.ChatGroupJoinRequests
            .AsNoTracking()
            .Where(r => r.ConversationId == conversationId && r.RequestStatus == normalizedStatus)
            .OrderByDescending(r => r.CreatedAt)
            .Select(BuildGroupJoinRequestProjection())
            .ToListAsync();

        return Ok(requests);
    }

    [HttpPost("conversations/{conversationId:ulong}/join-requests/{requestId:ulong}/approve")]
    public async Task<ActionResult<ConversationDetailDto>> ApproveGroupJoinRequest(
        ulong conversationId,
        ulong requestId)
    {
        var userId = GetUserId();
        await ExpirePendingGroupJoinRequests(conversationId);

        var context = await GetActiveConversationContext(conversationId, userId);
        if (context == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var (conversation, currentMember) = context.Value;
        if (conversation.ConversationType != "group")
            return BadRequest(new { message = "Only group conversations support join requests" });

        if (!CanManageJoinRequests(currentMember))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Only the owner or an admin can approve join requests" });

        var joinRequest = await _db.ChatGroupJoinRequests
            .Include(r => r.RequesterUser)
            .FirstOrDefaultAsync(r => r.Id == requestId && r.ConversationId == conversationId);

        if (joinRequest == null)
            return NotFound(new { message = "Join request not found" });

        if (joinRequest.RequestStatus != "pending")
            return BadRequest(new { message = "Only pending join requests can be approved" });

        if (joinRequest.ExpireAt != null && joinRequest.ExpireAt <= DateTime.UtcNow)
            return BadRequest(new { message = "This join request has expired" });

        if (joinRequest.RequesterUser == null || joinRequest.RequesterUser.IsDeleted || joinRequest.RequesterUser.Status != true)
            return BadRequest(new { message = "The requester account is no longer available" });

        var targetMember = conversation.ChatConversationMembers
            .FirstOrDefault(m => m.UserId == joinRequest.RequesterUserId);

        if (targetMember?.LeftAt == null)
        {
            var now = DateTime.UtcNow;
            joinRequest.RequestStatus = "approved";
            joinRequest.HandledByUserId = userId;
            joinRequest.HandledAt = now;
            joinRequest.RejectReason = null;
            joinRequest.UpdatedAt = now;

            await _db.SaveChangesAsync();

            var existingDetail = await BuildConversationDetail(conversationId, userId);
            return existingDetail == null ? NotFound(new { message = "Conversation not found" }) : Ok(existingDetail);
        }

        var activeMemberCount = conversation.ChatConversationMembers.Count(m => m.LeftAt == null);
        var memberLimit = conversation.MemberLimit == 0
            ? int.MaxValue
            : (int)Math.Min(conversation.MemberLimit, int.MaxValue);

        if (activeMemberCount + 1 > memberLimit)
            return BadRequest(new { message = "Approving this request would exceed the group member limit" });

        var approvedAt = DateTime.UtcNow;
        if (targetMember != null)
        {
            targetMember.MemberRole = "member";
            targetMember.MembershipStatus = "active";
            targetMember.JoinedAt = approvedAt;
            targetMember.InvitedAt = approvedAt;
            targetMember.InvitedByUserId = userId;
            targetMember.LeftAt = null;
            targetMember.RemovedByUserId = null;
            targetMember.RemovedReason = null;
            targetMember.MuteMode = null;
            targetMember.MuteUntil = null;
            targetMember.MuteReason = null;
            targetMember.MutedAt = null;
            targetMember.MutedByUserId = null;
            targetMember.UpdatedAt = approvedAt;
        }
        else
        {
            conversation.ChatConversationMembers.Add(new ChatConversationMember
            {
                ConversationId = conversationId,
                UserId = joinRequest.RequesterUserId,
                MemberRole = "member",
                MembershipStatus = "active",
                JoinedAt = approvedAt,
                InvitedAt = approvedAt,
                InvitedByUserId = userId,
                IsMuted = false,
                IsPinned = false,
                CreatedAt = approvedAt,
                UpdatedAt = approvedAt
            });
        }

        joinRequest.RequestStatus = "approved";
        joinRequest.HandledByUserId = userId;
        joinRequest.HandledAt = approvedAt;
        joinRequest.RejectReason = null;
        joinRequest.UpdatedAt = approvedAt;

        conversation.UpdatedAt = approvedAt;
        conversation.LastMessageAt = approvedAt;

        var operatorName = GetUserDisplayName(currentMember.User?.NickName, currentMember.User?.UserAccount, currentMember.UserId);
        var requesterName = GetUserDisplayName(
            joinRequest.RequesterUser.NickName,
            joinRequest.RequesterUser.UserAccount,
            joinRequest.RequesterUserId);
        var systemMessage = CreateSystemMessage(
            conversationId,
            userId,
            $"{operatorName} 同意 {requesterName} 的加群申请，{requesterName} 已加入群聊",
            approvedAt);

        AddGroupActionLog(
            conversationId,
            "join",
            userId,
            joinRequest.RequesterUserId,
            null,
            new
            {
                source = "join_request",
                requestId = joinRequest.Id
            },
            systemMessage);

        await _db.SaveChangesAsync();
        await BroadcastSystemMessage(systemMessage, approvedAt);

        var detail = await BuildConversationDetail(conversationId, userId);
        return detail == null ? NotFound(new { message = "Conversation not found" }) : Ok(detail);
    }

    [HttpPost("conversations/{conversationId:ulong}/join-requests/{requestId:ulong}/reject")]
    public async Task<ActionResult<ConversationDetailDto>> RejectGroupJoinRequest(
        ulong conversationId,
        ulong requestId,
        [FromBody] RejectGroupJoinRequestRequest? request = null)
    {
        var userId = GetUserId();
        await ExpirePendingGroupJoinRequests(conversationId);

        var context = await GetActiveConversationContext(conversationId, userId);
        if (context == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var (conversation, currentMember) = context.Value;
        if (conversation.ConversationType != "group")
            return BadRequest(new { message = "Only group conversations support join requests" });

        if (!CanManageJoinRequests(currentMember))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Only the owner or an admin can reject join requests" });

        var joinRequest = await _db.ChatGroupJoinRequests
            .FirstOrDefaultAsync(r => r.Id == requestId && r.ConversationId == conversationId);

        if (joinRequest == null)
            return NotFound(new { message = "Join request not found" });

        if (joinRequest.RequestStatus != "pending")
            return BadRequest(new { message = "Only pending join requests can be rejected" });

        if (joinRequest.ExpireAt != null && joinRequest.ExpireAt <= DateTime.UtcNow)
            return BadRequest(new { message = "This join request has expired" });

        var now = DateTime.UtcNow;
        joinRequest.RequestStatus = "rejected";
        joinRequest.HandledByUserId = userId;
        joinRequest.HandledAt = now;
        joinRequest.RejectReason = NormalizeReason(request?.RejectReason);
        joinRequest.UpdatedAt = now;

        await _db.SaveChangesAsync();

        var detail = await BuildConversationDetail(conversationId, userId);
        return detail == null ? NotFound(new { message = "Conversation not found" }) : Ok(detail);
    }

    [HttpPost("conversations/{conversationId:ulong}/members/{memberUserId:ulong}/kick")]
    public async Task<ActionResult<ConversationDetailDto>> KickConversationMember(
        ulong conversationId,
        ulong memberUserId,
        [FromBody] KickConversationMemberRequest? request = null)
    {
        var userId = GetUserId();
        var context = await GetActiveConversationContext(conversationId, userId, memberUserId);
        if (context == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var (conversation, currentMember) = context.Value;
        if (conversation.ConversationType != "group")
            return BadRequest(new { message = "Only group conversations support kicking members" });

        var targetMember = conversation.ChatConversationMembers
            .FirstOrDefault(m => m.UserId == memberUserId && m.LeftAt == null);
        if (targetMember == null)
            return NotFound(new { message = "Target member not found" });

        if (!CanModerateMember(currentMember, targetMember))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "You do not have permission to remove this member" });

        var now = DateTime.UtcNow;
        targetMember.LeftAt = now;
        targetMember.MembershipStatus = "kicked";
        targetMember.RemovedByUserId = userId;
        targetMember.RemovedReason = NormalizeReason(request?.Reason);
        targetMember.UpdatedAt = now;
        conversation.UpdatedAt = now;
        conversation.LastMessageAt = now;

        var operatorName = GetUserDisplayName(currentMember.User?.NickName, currentMember.User?.UserAccount, currentMember.UserId);
        var targetName = GetUserDisplayName(targetMember.User?.NickName, targetMember.User?.UserAccount, targetMember.UserId);
        var systemMessage = CreateSystemMessage(
            conversationId,
            userId,
            $"{operatorName} 将 {targetName} 移出了群聊",
            now);

        AddGroupActionLog(
            conversationId,
            "kick",
            userId,
            memberUserId,
            targetMember.RemovedReason,
            new
            {
                targetRole = targetMember.MemberRole
            },
            systemMessage);

        await _db.SaveChangesAsync();
        await BroadcastSystemMessage(systemMessage, now);

        var detail = await BuildConversationDetail(conversationId, userId);
        return detail == null ? NotFound(new { message = "Conversation not found" }) : Ok(detail);
    }

    [HttpPost("conversations/{conversationId:ulong}/members/{memberUserId:ulong}/mute")]
    public async Task<ActionResult<ConversationDetailDto>> MuteConversationMember(
        ulong conversationId,
        ulong memberUserId,
        MuteConversationMemberRequest request)
    {
        var userId = GetUserId();
        var context = await GetActiveConversationContext(conversationId, userId, memberUserId);
        if (context == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var (conversation, currentMember) = context.Value;
        if (conversation.ConversationType != "group")
            return BadRequest(new { message = "Only group conversations support muting members" });

        var targetMember = conversation.ChatConversationMembers
            .FirstOrDefault(m => m.UserId == memberUserId && m.LeftAt == null);
        if (targetMember == null)
            return NotFound(new { message = "Target member not found" });

        if (!CanModerateMember(currentMember, targetMember))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "You do not have permission to mute this member" });

        var muteMode = NormalizeValue(request.Mode);
        if (muteMode is not ("temporary" or "permanent"))
            return BadRequest(new { message = "mode only supports temporary or permanent" });

        if (muteMode == "temporary" && (!request.DurationMinutes.HasValue || request.DurationMinutes.Value <= 0))
            return BadRequest(new { message = "durationMinutes must be greater than 0 for temporary mute" });

        var now = DateTime.UtcNow;
        var durationMinutes = muteMode == "temporary" ? Math.Min(request.DurationMinutes!.Value, 60 * 24 * 30) : 0;
        var muteUntil = muteMode == "temporary" ? now.AddMinutes(durationMinutes) : (DateTime?)null;

        targetMember.MuteMode = muteMode;
        targetMember.MuteUntil = muteUntil;
        targetMember.MuteReason = NormalizeReason(request.Reason);
        targetMember.MutedAt = now;
        targetMember.MutedByUserId = userId;
        targetMember.UpdatedAt = now;
        conversation.UpdatedAt = now;
        conversation.LastMessageAt = now;

        var operatorName = GetUserDisplayName(currentMember.User?.NickName, currentMember.User?.UserAccount, currentMember.UserId);
        var targetName = GetUserDisplayName(targetMember.User?.NickName, targetMember.User?.UserAccount, targetMember.UserId);
        var systemContent = muteMode == "permanent"
            ? $"{operatorName} 已将 {targetName} 设为永久禁言"
            : $"{operatorName} 已将 {targetName} 禁言 {FormatMuteDuration(durationMinutes)}";
        var systemMessage = CreateSystemMessage(conversationId, userId, systemContent, now);

        AddGroupActionLog(
            conversationId,
            "mute",
            userId,
            memberUserId,
            targetMember.MuteReason,
            new
            {
                mode = muteMode,
                durationMinutes = muteMode == "temporary" ? (int?)durationMinutes : null,
                muteUntil
            },
            systemMessage);

        await _db.SaveChangesAsync();
        await BroadcastSystemMessage(systemMessage, now);

        var detail = await BuildConversationDetail(conversationId, userId);
        return detail == null ? NotFound(new { message = "Conversation not found" }) : Ok(detail);
    }

    [HttpPost("conversations/{conversationId:ulong}/members/{memberUserId:ulong}/unmute")]
    public async Task<ActionResult<ConversationDetailDto>> UnmuteConversationMember(
        ulong conversationId,
        ulong memberUserId)
    {
        var userId = GetUserId();
        var context = await GetActiveConversationContext(conversationId, userId, memberUserId);
        if (context == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var (conversation, currentMember) = context.Value;
        if (conversation.ConversationType != "group")
            return BadRequest(new { message = "Only group conversations support unmuting members" });

        var targetMember = conversation.ChatConversationMembers
            .FirstOrDefault(m => m.UserId == memberUserId && m.LeftAt == null);
        if (targetMember == null)
            return NotFound(new { message = "Target member not found" });

        if (!CanModerateMember(currentMember, targetMember))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "You do not have permission to unmute this member" });

        var now = DateTime.UtcNow;
        targetMember.MuteMode = null;
        targetMember.MuteUntil = null;
        targetMember.MuteReason = null;
        targetMember.MutedAt = null;
        targetMember.MutedByUserId = null;
        targetMember.UpdatedAt = now;
        conversation.UpdatedAt = now;
        conversation.LastMessageAt = now;

        var operatorName = GetUserDisplayName(currentMember.User?.NickName, currentMember.User?.UserAccount, currentMember.UserId);
        var targetName = GetUserDisplayName(targetMember.User?.NickName, targetMember.User?.UserAccount, targetMember.UserId);
        var systemMessage = CreateSystemMessage(
            conversationId,
            userId,
            $"{operatorName} 已解除 {targetName} 的禁言",
            now);

        AddGroupActionLog(
            conversationId,
            "unmute",
            userId,
            memberUserId,
            null,
            null,
            systemMessage);

        await _db.SaveChangesAsync();
        await BroadcastSystemMessage(systemMessage, now);

        var detail = await BuildConversationDetail(conversationId, userId);
        return detail == null ? NotFound(new { message = "Conversation not found" }) : Ok(detail);
    }

    [HttpPost("conversations/{conversationId:ulong}/disband")]
    public async Task<ActionResult<ConversationDetailDto>> DisbandConversation(
        ulong conversationId,
        [FromBody] DisbandConversationRequest? request = null)
    {
        var userId = GetUserId();
        var context = await GetActiveConversationContext(conversationId, userId);
        if (context == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var (conversation, currentMember) = context.Value;
        if (conversation.ConversationType != "group")
            return BadRequest(new { message = "Only group conversations can be disbanded" });

        if (!IsOwner(currentMember))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Only the owner can disband the group" });

        var now = DateTime.UtcNow;
        conversation.ConversationStatus = "disbanded";
        conversation.IsActive = false;
        conversation.DisbandedAt = now;
        conversation.DisbandedByUserId = userId;
        conversation.DisbandReason = NormalizeReason(request?.Reason);
        conversation.UpdatedAt = now;
        conversation.LastMessageAt = now;

        var operatorName = GetUserDisplayName(currentMember.User?.NickName, currentMember.User?.UserAccount, currentMember.UserId);
        var systemMessage = CreateSystemMessage(
            conversationId,
            userId,
            $"{operatorName} 已解散群聊",
            now);

        AddGroupActionLog(
            conversationId,
            "disband",
            userId,
            null,
            conversation.DisbandReason,
            null,
            systemMessage);

        await _db.SaveChangesAsync();
        await BroadcastSystemMessage(systemMessage, now);

        var detail = await BuildConversationDetail(conversationId, userId);
        return detail == null ? NotFound(new { message = "Conversation not found" }) : Ok(detail);
    }

    /// <summary>
    /// 获取当前用户的会话列表（收件箱）。
    /// 按置顶状态和最后消息时间排序，并计算每个会话的未读消息数。
    /// </summary>
    /// <returns>会话概要列表，包含最后一条消息预览和未读数。</returns>
    [HttpGet("conversations")]
    public async Task<ActionResult<List<ConversationSummaryDto>>> GetMyConversations()
    {
        var userId = GetUserId();

        var memberships = await _db.ChatConversationMembers
            .AsNoTracking()
            .Where(m => m.UserId == userId
                && m.LeftAt == null
                && !m.IsHidden
                && m.Conversation.IsActive == true)
            .Select(m => new
            {
                m.ConversationId,
                m.LastReadMessageId,
                m.IsPinned,
                m.UpdatedAt
            })
            .ToListAsync();

        if (memberships.Count == 0)
            return Ok(new List<ConversationSummaryDto>());

        var conversationIds = memberships.Select(m => m.ConversationId).ToList();

        var conversationDtos = await _db.ChatConversations
            .AsNoTracking()
            .Where(c => conversationIds.Contains(c.Id))
            .Select(BuildConversationSummaryProjection(userId))
            .ToListAsync();

        // 会话预览：按「当前用户的可见范围」取每个会话最新的那条消息。
        //
        // 不能直接写进 ConversationSummary 投影里：Pomelo 对这种「带相关子查询的
        // OUTER APPLY」支持不完整，会抛 "could not be translated"。拆成两步：
        //   1) 每个会话在「清除游标之后、且未被本人删除」的消息里取最大 ID；
        //   2) 再按这些 ID 一次性取消息摘要。
        var lastMessageIdRows = await (
            from message in _db.ChatMessages.AsNoTracking()
            join member in _db.ChatConversationMembers.AsNoTracking()
                on message.ConversationId equals member.ConversationId
            where member.UserId == userId
                && member.LeftAt == null
                && !member.IsHidden
                && conversationIds.Contains(message.ConversationId)
                && message.Id > (member.HistoryClearedBeforeMessageId ?? 0UL)
                && !message.ChatMessageDeletions.Any(d => d.UserId == userId)
            group message by message.ConversationId into grouped
            select new
            {
                ConversationId = grouped.Key,
                LastMessageId = grouped.Max(message => message.Id)
            })
            .ToListAsync();

        var lastMessageIdMap = lastMessageIdRows.ToDictionary(
            row => row.ConversationId,
            row => row.LastMessageId);

        var lastMessageIds = lastMessageIdMap.Values.Distinct().ToList();
        var lastMessages = lastMessageIds.Count == 0
            ? new List<MessageSummaryDto>()
            : await _db.ChatMessages
                .AsNoTracking()
                .Where(message => lastMessageIds.Contains(message.Id))
                .Select(message => new MessageSummaryDto
                {
                    Id = message.Id,
                    SenderUserId = message.MessageType == "system" ? 0UL : message.SenderUserId,
                    SenderNickName = message.MessageType == "system" ? "系统" : message.SenderUser.NickName,
                    MessageType = message.MessageType,
                    Content = message.IsRecalled ? null : message.Content,
                    Extra = message.IsRecalled ? null : message.Extra,
                    ReplyToMessageId = message.ReplyToMessageId,
                    RecalledByUserId = message.RecalledByUserId,
                    RecallPrompt = message.RecallPrompt,
                    IsRecalled = message.IsRecalled,
                    CreatedAt = message.CreatedAt
                })
                .ToListAsync();

        var lastMessageById = lastMessages.ToDictionary(message => message.Id);
        foreach (var item in conversationDtos)
        {
            if (lastMessageIdMap.TryGetValue(item.Id, out var lastMessageId)
                && lastMessageById.TryGetValue(lastMessageId, out var lastMessage))
            {
                item.LastMessage = lastMessage;
            }
        }

        var unreadCounts = await (
            from message in _db.ChatMessages.AsNoTracking()
            join member in _db.ChatConversationMembers.AsNoTracking()
                on message.ConversationId equals member.ConversationId
            where member.UserId == userId
                && member.LeftAt == null
                && !member.IsHidden
                && conversationIds.Contains(message.ConversationId)
                && message.SenderUserId != userId
                && message.MessageType != "system"
                && !message.IsRecalled
                && message.Id > (member.LastReadMessageId ?? 0UL)
                && message.Id > (member.HistoryClearedBeforeMessageId ?? 0UL)
                && !message.ChatMessageDeletions.Any(d => d.UserId == userId)
            group message by message.ConversationId into grouped
            select new
            {
                ConversationId = grouped.Key,
                Count = grouped.Count()
            })
            .ToDictionaryAsync(x => x.ConversationId, x => x.Count);

        var membershipMap = memberships.ToDictionary(x => x.ConversationId);
        foreach (var item in conversationDtos)
        {
            item.UnreadCount = unreadCounts.GetValueOrDefault(item.Id);
        }

        var ordered = conversationDtos
            .OrderByDescending(x => membershipMap[x.Id].IsPinned)
            .ThenByDescending(x => x.LastMessage?.Id ?? 0)
            .ToList();

        return Ok(ordered);
    }

    /// <summary>
    /// 更新会话信息或成员个人设置（如置顶、免打扰）。
    /// 群聊的基础信息（标题、头像）仅群主或管理员可修改。
    /// </summary>
    /// <param name="conversationId">会话ID。</param>
    /// <param name="request">更新请求参数，包含标题、头像、置顶状态等。</param>
    /// <returns>更新后的会话详细信息。</returns>
    [HttpPost("conversations/{conversationId:ulong}")]
    public async Task<ActionResult<ConversationDetailDto>> UpdateConversation(ulong conversationId, UpdateConversationRequest request)
    {
        var userId = GetUserId();
        var conversation = await _db.ChatConversations
            .Include(c => c.ChatConversationMembers)
            .FirstOrDefaultAsync(c => c.Id == conversationId && c.IsActive == true);

        if (conversation == null)
        {
            return NotFound(new { message = "Conversation not found" });
        }
        if (!conversation.ChatConversationMembers.Any(m => m.UserId == userId && m.LeftAt == null))
        {
            return NotFound(new { message = "Conversation not found or access denied" });
        }
        // 閺囧瓨鏌婃导姘崇樈娣団剝浼呴崚鐗堟殶閹诡喖绨?
        var chatConversationMember = conversation.ChatConversationMembers
            .FirstOrDefault(m => m.UserId == userId && m.LeftAt == null);
        if (chatConversationMember == null)
        {
            return NotFound(new { message = "Conversation not found" });
        }
        var memberRole = (chatConversationMember.MemberRole ?? string.Empty).Trim().ToLowerInvariant();
        var canManageGroupConversation = conversation.ConversationType == "group" && (memberRole == "owner" || memberRole == "admin");

        // 只有「值真的变了」才算修改群资料。
        // 旧实现只看「字段是否出现在请求里」：前端提交整个会话对象
        // （带着当前标题和 isActive），于是普通成员切换「置顶/免打扰」这种
        // 个人设置时也会被判成改群资料 → 403。
        var isUpdatingConversationMetadata =
            (!string.IsNullOrWhiteSpace(request.Title)
                && !string.Equals(request.Title, conversation.Title, StringComparison.Ordinal))
            || (!string.IsNullOrWhiteSpace(request.AvatarKey)
                && !string.Equals(request.AvatarKey, conversation.AvatarKey, StringComparison.Ordinal))
            || (request.IsActive.HasValue && request.IsActive.Value != conversation.IsActive);

        if (conversation.ConversationType == "group" && isUpdatingConversationMetadata && !canManageGroupConversation)
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "只有群主或管理员可以修改群资料（标题、头像、启用状态）" });
        }

        if (!string.IsNullOrWhiteSpace(request.Title))
            conversation.Title = request.Title;
        if (!string.IsNullOrWhiteSpace(request.AvatarKey))
            conversation.AvatarKey = request.AvatarKey;
        if (request.IsActive != null)
            conversation.IsActive = request.IsActive;
        if (request.IsMuted != null)
            chatConversationMember.IsMuted = request.IsMuted ?? chatConversationMember.IsMuted;
        if (request.IsPinned != null)
            chatConversationMember.IsPinned = request.IsPinned ?? chatConversationMember.IsPinned;

        await _db.SaveChangesAsync();
        var detail = await BuildConversationDetail(conversationId, userId);
        return detail == null ? NotFound(new { message = "Conversation not found" }) : Ok(detail);
    }

    /// <summary>
    /// 根据ID获取会话详细信息。
    /// 包含成员列表、最后消息、未读数及个人设置（置顶、免打扰）。
    /// 仅会话成员有权访问。
    /// </summary>
    /// <param name="conversationId">会话ID。</param>
    /// <returns>会话详细信息。</returns>
    [HttpGet("conversations/{conversationId:ulong}")]
    public async Task<ActionResult<ConversationDetailDto>> GetConversationById(ulong conversationId)
    {
        var userId = GetUserId();
        var isMember = await _db.ChatConversationMembers
            .AsNoTracking()
            .AnyAsync(m => m.ConversationId == conversationId && m.UserId == userId && m.LeftAt == null);

        if (!isMember)
            return NotFound(new { message = "Conversation not found or access denied" });

        var detail = await BuildConversationDetail(conversationId, userId);
        return detail == null ? NotFound(new { message = "Conversation not found" }) : Ok(detail);
    }

    /// <summary>
    /// 在指定会话中发送消息。
    /// 支持文本、图片、视频、音频、文件及系统消息。
    /// 发送成功后通过 SignalR 实时推送给会话内其他在线成员。
    /// </summary>
    /// <param name="conversationId">目标会话ID。</param>
    /// <param name="request">发送消息请求，包含内容、类型及回复引用。</param>
    /// <returns>发送成功的消息概要信息。</returns>
    [HttpPost("conversations/{conversationId:ulong}/messages")]
    public async Task<ActionResult<MessageSummaryDto>> SendMessage(ulong conversationId, SendMessageRequest request)
    {
        var userId = GetUserId();

        var membership = await _db.ChatConversationMembers
            .Include(m => m.Conversation)
            .SingleOrDefaultAsync(m => m.ConversationId == conversationId && m.UserId == userId && m.LeftAt == null);

        if (membership == null || membership.Conversation.IsActive != true)
            return NotFound(new { message = "Conversation not found or sending is not allowed" });

        // 单聊：被对方拉黑后不能再发送消息；群聊不受影响。
        if (membership.Conversation.ConversationType == "direct")
        {
            var peerUserId = await _db.ChatConversationMembers
                .AsNoTracking()
                .Where(m =>
                    m.ConversationId == conversationId &&
                    m.UserId != userId &&
                    m.LeftAt == null)
                .Select(m => m.UserId)
                .FirstOrDefaultAsync();

            if (peerUserId != 0 && await IsBlockedBy(peerUserId, userId))
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { message = "对方已将你拉黑，无法发送消息" });
        }

        if (membership.Conversation.ConversationType == "group" && IsGroupMuteActive(membership, DateTime.UtcNow))
        {
            var muteMessage = membership.MuteUntil.HasValue && NormalizeValue(membership.MuteMode) == "temporary"
                ? $"You are muted until {membership.MuteUntil.Value:O}"
                : "You are muted in this group";
            return StatusCode(StatusCodes.Status403Forbidden, new { message = muteMessage });
        }

        var messageType = (request.MessageType ?? string.Empty).Trim().ToLowerInvariant();
        if (!AllowedMessageTypes.Contains(messageType))
            return BadRequest(new { message = "messageType 娴犲懏鏁幐?text/image/video/audio/file/system" });

        if (messageType == "text" && string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { message = "閺傚洦婀板☉鍫熶紖 content 娑撳秷鍏樻稉铏光敄" });

        // 閺傚洣娆㈢猾缁樼Х閹垶娓剁憰涔獂tra鐎涙顔岄崠鍛儓閺傚洣娆㈡穱鈩冧紖
        if ((messageType == "image" || messageType == "video" || messageType == "audio" || messageType == "file")
            && request.Extra == null)
            return BadRequest(new { message = $"{messageType} 濞戝牊浼?extra 娑撳秷鍏樻稉铏光敄閿涘矂娓堕崠鍛儓閺傚洣娆㈡穱鈩冧紖" });

        if (request.ReplyToMessageId.HasValue)
        {
            var replyExists = await _db.ChatMessages.AnyAsync(x => x.Id == request.ReplyToMessageId.Value && x.ConversationId == conversationId);
            if (!replyExists)
                return BadRequest(new { message = "replyToMessageId does not exist or does not belong to this conversation" });
        }

        if (messageType == "image" || messageType == "video" || messageType == "audio" || messageType == "file")
            request.Content = request.Extra?.FileKey;

        var now = DateTime.UtcNow;

        // 会话被成员「删除」后（IsHidden=true），新消息到达时应重新出现在其收件箱里。
        // 只清隐藏标记，不清 HistoryClearedBeforeMessageId —— 旧聊天记录仍然保持不可见。
        var hiddenMemberships = await _db.ChatConversationMembers
            .Where(m => m.ConversationId == conversationId && m.LeftAt == null && m.IsHidden)
            .ToListAsync();
        foreach (var hiddenMembership in hiddenMemberships)
        {
            hiddenMembership.IsHidden = false;
            hiddenMembership.UpdatedAt = now;
        }

        var message = new ChatMessage
        {
            ConversationId = conversationId,
            SenderUserId = userId,
            MessageType = messageType,
            Content = request.Content,
            Extra = request.Extra == null ? null : JsonSerializer.Serialize(request.Extra),
            ReplyToMessageId = request.ReplyToMessageId,
            IsRecalled = false,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.ChatMessages.Add(message);
        membership.UpdatedAt = now;
        membership.Conversation.UpdatedAt = now;
        membership.Conversation.LastMessageAt = now;

        // 注意：这里不再把发送者自己的 LastReadMessageId 推进到刚发出的消息。
        // 旧实现会因此把对端更早的未读消息「顺手」标记为已读：
        // 未读数按 Id > LastReadMessageId 计算，一旦光标被推进到 #103，
        // 对端的 #101/#102 就永远不再算未读，也永远补不上已读回执。
        await _db.SaveChangesAsync();

        var result = await BuildMessageSummary(message.Id);

        await _hubContext.Clients.Group(ChatHub.GroupName(conversationId)).SendAsync("chat:message-updated", new
        {
            conversationId,
            messageId = message.Id,
            messageType = messageType,
            createdAt = now,
            action = "create",
            message = result
        });
        await NotifyConversationInboxUpdated(conversationId);

        return Ok(result);
    }

    /// <summary>
    /// 撤回消息。
    ///
    /// 规则：
    ///   · 自己的消息：发送后 5 分钟内可撤回；
    ///   · 群聊里的其他成员消息：群主可撤回管理员/成员的消息，管理员仅可撤回成员的消息；
    ///     命中这条「管理撤回」时，提示会直接挂在被撤回的消息上，在原来的位置展示：
    ///     {群内身份} {操作人昵称} 撤回了 {被撤回消息的成员昵称} 的消息；
    ///   · 没有权限时直接 403；前端的右键菜单也不会显示「撤回」。
    ///
    /// 撤回后消息内容会被清空，并标记为已撤回状态；管理撤回的提示保存在 recall_prompt，
    /// 不会再在会话底部追加一条系统消息。
    /// </summary>
    /// <param name="messageId">要撤回的消息ID。</param>
    /// <returns>撤回后的消息概要信息。</returns>
    [HttpPost("messages/{messageId:ulong}/recall")]
    public async Task<ActionResult<MessageSummaryDto>> RecallMessage(ulong messageId)
    {
        const int recallWindowMinutes = 5;
        var userId = GetUserId();

        var message = await _db.ChatMessages
            .Include(m => m.Conversation)
            .Include(m => m.SenderUser)
            .FirstOrDefaultAsync(m => m.Id == messageId);

        if (message == null)
            return NotFound(new { message = "Message not found" });

        if (message.Conversation.IsActive != true)
            return NotFound(new { message = "Conversation not found or access denied" });

        var currentMember = await _db.ChatConversationMembers
            .Include(m => m.User)
            .FirstOrDefaultAsync(m =>
                m.ConversationId == message.ConversationId &&
                m.UserId == userId &&
                m.LeftAt == null);

        if (currentMember == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        if (message.MessageType == "system")
            return BadRequest(new { message = "系统消息不支持撤回" });

        var isOwnMessage = message.SenderUserId == userId;
        var isGroupConversation = message.Conversation.ConversationType == "group";
        var currentRole = NormalizeValue(currentMember.MemberRole);
        var isModerationRecall = false;

        if (!isOwnMessage)
        {
            // 群主 / 管理员可以撤回其他成员的消息；单聊与普通成员没有这个权限。
            if (!isGroupConversation)
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "没有权限撤回该消息" });

            var targetMember = await _db.ChatConversationMembers
                .AsNoTracking()
                .FirstOrDefaultAsync(m =>
                    m.ConversationId == message.ConversationId &&
                    m.UserId == message.SenderUserId &&
                    m.LeftAt == null);

            var targetRole = NormalizeValue(targetMember?.MemberRole);
            var canModerate = currentRole switch
            {
                // 群主可以撤回管理员/成员的消息，但不能撤回群主（自己）的消息。
                "owner" => targetRole != "owner",
                // 管理员只能撤回普通成员的消息，不能动群主或其它管理员。
                "admin" => targetRole == "member",
                _ => false
            };

            if (!canModerate)
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "没有权限撤回该消息" });

            isModerationRecall = true;
        }

        if (message.IsRecalled)
            return Ok(await BuildMessageSummary(message.Id));

        var now = DateTime.UtcNow;

        // 5 分钟窗口只约束「撤回自己的消息」；群主/管理员撤回他人消息不受此限。
        if (isOwnMessage && message.CreatedAt.AddMinutes(recallWindowMinutes) < now)
            return BadRequest(new { message = $"Messages older than {recallWindowMinutes} minutes cannot be recalled" });

        message.IsRecalled = true;
        message.RecalledAt = now;
        message.RecalledByUserId = userId;
        message.Content = null;
        message.Extra = null;
        message.UpdatedAt = now;

        if (isModerationRecall)
        {
            var roleLabel = currentRole == "owner" ? "群主" : "管理员";
            var operatorName = GetUserDisplayName(
                currentMember.User?.NickName,
                currentMember.User?.UserAccount,
                userId);
            var senderName = GetUserDisplayName(
                message.SenderUser?.NickName,
                message.SenderUser?.UserAccount,
                message.SenderUserId);

            // 管理撤回的提示直接挂在被撤回的消息上：
            // 前端会在消息原来的位置渲染这句话，而不是在会话底部再追加一条系统消息。
            message.RecallPrompt = $"{roleLabel} {operatorName} 撤回了 {senderName} 的消息";
        }
        else
        {
            // 自己撤回自己的消息：继续使用「xxx 撤回了一条消息」的普通占位文案。
            message.RecallPrompt = null;
        }

        await _db.SaveChangesAsync();

        var result = await BuildMessageSummary(message.Id);

        await _hubContext.Clients.Group(ChatHub.GroupName(message.ConversationId)).SendAsync("chat:message-updated", new
        {
            conversationId = message.ConversationId,
            messageId = message.Id,
            action = "recall",
            updatedAt = now,
            message = result
        });
        await NotifyConversationInboxUpdated(message.ConversationId);

        return Ok(result);
    }

    /// <summary>
    /// 删除一条消息（仅自己不可见，伪删除）。
    ///
    /// 真正的消息记录仍然保留在 chat_messages 中，对方、其它成员都不受影响；
    /// 仅在 chat_message_deletions 写入一条 (messageId, userId) 标记，
    /// 之后当前用户拉取消息、会话预览与未读数时都会把它过滤掉。
    /// </summary>
    /// <param name="messageId">要隐藏的消息ID。</param>
    /// <returns>隐藏结果。</returns>
    [HttpPost("messages/{messageId:ulong}/delete")]
    public async Task<ActionResult<DeleteMessageResultDto>> DeleteMessageForMe(ulong messageId)
    {
        var userId = GetUserId();

        var message = await _db.ChatMessages
            .AsNoTracking()
            .Where(m => m.Id == messageId)
            .Select(m => new { m.Id, m.ConversationId })
            .FirstOrDefaultAsync();

        if (message == null)
            return NotFound(new { message = "Message not found" });

        var isMember = await _db.ChatConversationMembers
            .AsNoTracking()
            .AnyAsync(m => m.ConversationId == message.ConversationId && m.UserId == userId && m.LeftAt == null);

        if (!isMember)
            return NotFound(new { message = "Conversation not found or access denied" });

        var alreadyHidden = await _db.ChatMessageDeletions
            .AsNoTracking()
            .AnyAsync(d => d.MessageId == messageId && d.UserId == userId);

        if (!alreadyHidden)
        {
            var now = DateTime.UtcNow;

            _db.ChatMessageDeletions.Add(new ChatMessageDeletion
            {
                MessageId = messageId,
                UserId = userId,
                Reason = "用户删除消息（仅自己不可见）",
                DeletedAt = now
            });

            // 同步留一条审计日志，方便追踪「谁在什么时候隐藏了哪条消息」。
            _db.SoftDeleteLogs.Add(new SoftDeleteLog
            {
                TableName = "chat_messages",
                RecordId = messageId,
                DeleterUserId = userId,
                Reason = "用户删除消息（仅自己不可见）",
                DeletedAt = now,
                Extra = JsonSerializer.Serialize(new { conversationId = message.ConversationId })
            });

            await _db.SaveChangesAsync();

            // 同一账号的其它设备/标签页也要把这条消息从界面上摘掉。
            await _hubContext.Clients.Group(ChatHub.UserGroupName(userId)).SendAsync("chat:message-deleted", new
            {
                conversationId = message.ConversationId,
                messageId,
                deletedAt = now
            });
            await NotifyConversationInboxUpdated(message.ConversationId);
        }

        return Ok(new DeleteMessageResultDto
        {
            MessageId = messageId,
            ConversationId = message.ConversationId,
            Hidden = true
        });
    }

    /// <summary>
    /// 删除会话聊天记录（仅自己不可见，伪删除）。
    ///
    /// 这里不物理删除会话、也不删除消息，而是在当前用户的成员记录上打两个标记：
    ///   · is_hidden = true：会话从当前用户的收件箱消失；
    ///   · history_cleared_before_message_id = 当前最新消息ID：
    ///     旧消息对当前用户不可见，对方的记录不受影响。
    ///
    /// 之后若收到新消息，is_hidden 会被自动清掉、会话重新出现，
    /// 而 history_cleared_before_message_id 保持不变，旧记录仍然看不到。
    /// </summary>
    /// <param name="conversationId">会话ID。</param>
    /// <returns>删除结果。</returns>
    [HttpPost("conversations/{conversationId:ulong}/delete")]
    public async Task<ActionResult<DeleteConversationHistoryResultDto>> DeleteConversationHistory(ulong conversationId)
    {
        var userId = GetUserId();

        var membership = await _db.ChatConversationMembers
            .FirstOrDefaultAsync(m => m.ConversationId == conversationId
                                   && m.UserId == userId
                                   && m.LeftAt == null);

        if (membership == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var now = DateTime.UtcNow;

        var lastMessageId = await _db.ChatMessages
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.Id)
            .Select(m => (ulong?)m.Id)
            .FirstOrDefaultAsync() ?? 0;

        membership.IsHidden = true;

        // 只前进不后退：别让重复删除把已经清掉的记录又放出来。
        if (lastMessageId > (membership.HistoryClearedBeforeMessageId ?? 0))
            membership.HistoryClearedBeforeMessageId = lastMessageId;

        membership.HistoryClearedAt = now;

        // 旧消息都清掉了，未读游标也顺势推到最新，避免会话重新出现时冒出一堆陈年未读。
        if (lastMessageId > (membership.LastReadMessageId ?? 0))
            membership.LastReadMessageId = lastMessageId;

        membership.UpdatedAt = now;

        _db.SoftDeleteLogs.Add(new SoftDeleteLog
        {
            TableName = "chat_conversation_members",
            RecordId = membership.Id,
            DeleterUserId = userId,
            Reason = "用户删除会话聊天记录（仅自己）",
            DeletedAt = now,
            Extra = JsonSerializer.Serialize(new
            {
                conversationId,
                clearedBeforeMessageId = membership.HistoryClearedBeforeMessageId
            })
        });

        await _db.SaveChangesAsync();
        await NotifyConversationInboxUpdated(conversationId);

        return Ok(new DeleteConversationHistoryResultDto
        {
            ConversationId = conversationId,
            ClearedBeforeMessageId = membership.HistoryClearedBeforeMessageId ?? 0,
            Hidden = true
        });
    }

    /// <summary>
    /// 分页获取会话的历史消息记录。
    /// 采用倒序加载（从最新往旧加载），支持指定最后一条消息ID作为游标。
    /// </summary>
    /// <param name="conversationId">会话ID。</param>
    /// <param name="beforeMessageId">获取此ID之前的消息（不包含此ID）。</param>
    /// <param name="pageSize">每页数量，默认20，最大100。</param>
    /// <returns>消息概要列表，按时间正序排列。</returns>
    [HttpGet("conversations/{conversationId:ulong}/messages")]
    public async Task<ActionResult<List<MessageSummaryDto>>> GetMessages(ulong conversationId, [FromQuery] ulong? beforeMessageId, [FromQuery] int pageSize = 20)
    {
        var userId = GetUserId();
        var membership = await _db.ChatConversationMembers
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId && m.UserId == userId && m.LeftAt == null)
            .Select(m => new { m.HistoryClearedBeforeMessageId })
            .FirstOrDefaultAsync();
        if (membership == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var clearedBefore = membership.HistoryClearedBeforeMessageId ?? 0;
        var normalizedPageSize = Math.Clamp(pageSize, 1, 100);

        var query = _db.ChatMessages
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
            // 当前用户「删除会话」时清掉的历史，以及按条删除的消息，都不再返回。
            .Where(m => m.Id > clearedBefore)
            .Where(m => !m.ChatMessageDeletions.Any(d => d.UserId == userId));

        if (beforeMessageId.HasValue)
            query = query.Where(m => m.Id < beforeMessageId.Value);

        var messages = await query
            .OrderByDescending(m => m.Id)
            .Take(normalizedPageSize)
            .Select(m => new MessageSummaryDto
            {
                Id = m.Id,
                SenderUserId = m.MessageType == "system" ? 0UL : m.SenderUserId,
                SenderNickName = m.MessageType == "system" ? "系统" : m.SenderUser.NickName,
                MessageType = m.MessageType,
                Content = m.IsRecalled ? null : m.Content,
                Extra = m.IsRecalled ? null : m.Extra,
                ReplyToMessageId = m.ReplyToMessageId,
                ReplyToMessage = m.ReplyToMessage == null ? null : new MessageReferenceDto
                {
                    Id = m.ReplyToMessage.Id,
                    SenderUserId = m.ReplyToMessage.MessageType == "system" ? 0UL : m.ReplyToMessage.SenderUserId,
                    SenderNickName = m.ReplyToMessage.MessageType == "system" ? "系统" : m.ReplyToMessage.SenderUser.NickName,
                    MessageType = m.ReplyToMessage.MessageType,
                    Content = m.ReplyToMessage.IsRecalled ? null : m.ReplyToMessage.Content,
                    Extra = m.ReplyToMessage.IsRecalled ? null : m.ReplyToMessage.Extra,
                    RecalledByUserId = m.ReplyToMessage.RecalledByUserId,
                    RecallPrompt = m.ReplyToMessage.RecallPrompt,
                    IsRecalled = m.ReplyToMessage.IsRecalled,
                    CreatedAt = m.ReplyToMessage.CreatedAt
                },
                RecalledByUserId = m.RecalledByUserId,
                RecallPrompt = m.RecallPrompt,
                IsRecalled = m.IsRecalled,
                CreatedAt = m.CreatedAt
            })
            .ToListAsync();
        messages.Reverse();
        return Ok(messages);
    }

    /// <summary>
    /// 增量获取会话消息（用于同步新消息）。
    /// 获取指定ID之后的最新消息，适用于前端轮询或长连接断开后的数据补全。
    /// </summary>
    /// <param name="conversationId">会话ID。</param>
    /// <param name="afterMessageId">获取此ID之后的消息。</param>
    /// <param name="pageSize">每页数量，默认50，最大100。</param>
    /// <returns>包含最新消息ID和消息列表的增量数据包。</returns>
    [HttpGet("conversations/{conversationId:ulong}/messages/delta")]
    public async Task<ActionResult<MessageDeltaDto>> GetMessageDelta(ulong conversationId, [FromQuery] ulong? afterMessageId, [FromQuery] int pageSize = 50)
    {
        var userId = GetUserId();
        var membership = await _db.ChatConversationMembers
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId && m.UserId == userId && m.LeftAt == null)
            .Select(m => new { m.HistoryClearedBeforeMessageId })
            .FirstOrDefaultAsync();
        if (membership == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var clearedBefore = membership.HistoryClearedBeforeMessageId ?? 0;
        var normalizedPageSize = Math.Clamp(pageSize, 1, 100);
        var threshold = Math.Max(afterMessageId ?? 0, clearedBefore);
        var lastMessageId = await _db.ChatMessages
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId)
            .Where(m => m.Id > clearedBefore)
            .Where(m => !m.ChatMessageDeletions.Any(d => d.UserId == userId))
            .OrderByDescending(m => m.Id)
            .Select(m => (ulong?)m.Id)
            .FirstOrDefaultAsync() ?? 0;

        var records = await _db.ChatMessages
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId && m.Id > threshold)
            .Where(m => !m.ChatMessageDeletions.Any(d => d.UserId == userId))
            .OrderBy(m => m.Id)
            .Take(normalizedPageSize + 1)
            .Select(m => new MessageSummaryDto
            {
                Id = m.Id,
                SenderUserId = m.MessageType == "system" ? 0UL : m.SenderUserId,
                SenderNickName = m.MessageType == "system" ? "系统" : m.SenderUser.NickName,
                MessageType = m.MessageType,
                Content = m.IsRecalled ? null : m.Content,
                Extra = m.IsRecalled ? null : m.Extra,
                ReplyToMessageId = m.ReplyToMessageId,
                ReplyToMessage = m.ReplyToMessage == null ? null : new MessageReferenceDto
                {
                    Id = m.ReplyToMessage.Id,
                    SenderUserId = m.ReplyToMessage.MessageType == "system" ? 0UL : m.ReplyToMessage.SenderUserId,
                    SenderNickName = m.ReplyToMessage.MessageType == "system" ? "系统" : m.ReplyToMessage.SenderUser.NickName,
                    MessageType = m.ReplyToMessage.MessageType,
                    Content = m.ReplyToMessage.IsRecalled ? null : m.ReplyToMessage.Content,
                    Extra = m.ReplyToMessage.IsRecalled ? null : m.ReplyToMessage.Extra,
                    RecalledByUserId = m.ReplyToMessage.RecalledByUserId,
                    RecallPrompt = m.ReplyToMessage.RecallPrompt,
                    IsRecalled = m.ReplyToMessage.IsRecalled,
                    CreatedAt = m.ReplyToMessage.CreatedAt
                },
                RecalledByUserId = m.RecalledByUserId,
                RecallPrompt = m.RecallPrompt,
                IsRecalled = m.IsRecalled,
                CreatedAt = m.CreatedAt
            })
            .ToListAsync();

        var hasMore = records.Count > normalizedPageSize;
        if (hasMore)
            records = records.Take(normalizedPageSize).ToList();

        return Ok(new MessageDeltaDto
        {
            LastMessageId = lastMessageId,
            HasMore = hasMore,
            Messages = records
        });
    }

    /// <summary>
    /// 标记会话为已读。
    /// 更新用户的最后阅读消息ID，并为相关消息创建已读回执。
    /// 通过 SignalR 通知其他成员消息已被阅读。
    /// </summary>
    /// <param name="conversationId">会话ID。</param>
    /// <param name="request">已读请求，可选指定最后阅读的消息ID。</param>
    /// <returns>操作结果，包含更新后的最后阅读消息ID。</returns>
    [HttpPost("conversations/{conversationId:ulong}/read")]
    public async Task<ActionResult> MarkConversationRead(ulong conversationId, ReadConversationRequest request)
    {
        var userId = GetUserId();

        var membership = await _db.ChatConversationMembers
            .SingleOrDefaultAsync(m => m.ConversationId == conversationId && m.UserId == userId && m.LeftAt == null);
        if (membership == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        ulong? targetMessageId = request.LastReadMessageId;

        if (!targetMessageId.HasValue)
        {
            targetMessageId = await _db.ChatMessages
                .Where(m => m.ConversationId == conversationId)
                .Where(m => m.Id > (membership.HistoryClearedBeforeMessageId ?? 0))
                .Where(m => !m.ChatMessageDeletions.Any(d => d.UserId == userId))
                .OrderByDescending(m => m.Id)
                .Select(m => (ulong?)m.Id)
                .FirstOrDefaultAsync();
        }

        if (targetMessageId.HasValue)
        {
            var exists = await _db.ChatMessages.AnyAsync(m => m.Id == targetMessageId.Value && m.ConversationId == conversationId);
            if (!exists)
                return BadRequest(new { message = "lastReadMessageId does not exist or does not belong to this conversation" });
        }

        var previousLastRead = membership.LastReadMessageId ?? 0;
        if (targetMessageId.HasValue && targetMessageId.Value < previousLastRead)
        {
            targetMessageId = previousLastRead;
        }

        var now = DateTime.UtcNow;
        var readStateChanged = membership.LastReadMessageId != targetMessageId;
        membership.LastReadMessageId = targetMessageId;
        membership.UpdatedAt = now;

        var newReceiptMessageIds = new List<ulong>();
        if (targetMessageId.HasValue && targetMessageId.Value > previousLastRead)
        {
            // 回执按「Id <= target」补齐，而不是只补上一次光标之后的那一段：
            // 光标可能因为别的原因跳跃（历史数据、其他端标记已读），
            // 只用 (previousLastRead, target] 会让中间的消息永远拿不到回执。
            // system / 已撤回消息不产生已读回执；已经存在的回执由 NOT EXISTS 直接排除。
            var readIds = await _db.ChatMessages
                .Where(m => m.ConversationId == conversationId
                    && m.Id <= targetMessageId.Value
                    && m.Id > (membership.HistoryClearedBeforeMessageId ?? 0)
                    && !m.ChatMessageDeletions.Any(d => d.UserId == userId)
                    && m.SenderUserId != userId
                    && m.MessageType != "system"
                    && !m.IsRecalled
                    && !_db.ChatMessageReceipts.Any(r => r.MessageId == m.Id && r.UserId == userId))
                .OrderByDescending(m => m.Id)
                .Take(500)
                .Select(m => m.Id)
                .ToListAsync();

            if (readIds.Count > 0)
            {
                var newReceipts = readIds
                    .Select(messageId => new ChatMessageReceipt
                    {
                        MessageId = messageId,
                        UserId = userId,
                        ReadAt = now
                    })
                    .ToList();

                _db.ChatMessageReceipts.AddRange(newReceipts);
                newReceiptMessageIds = newReceipts
                    .Select(r => r.MessageId)
                    .OrderBy(id => id)
                    .ToList();
            }
        }

        // 光标和回执放在同一次 SaveChanges 里提交：
        // 旧实现先保存光标、再保存回执，是两次写往返（这个接口每次打开会话都会调用）。
        if (readStateChanged || newReceiptMessageIds.Count > 0)
            await _db.SaveChangesAsync();

        // 一次批量广播即可：前端会合并同一时间窗内的回执再查一次状态，
        // 旧的逐条 await 会把 N 条回执变成 N 次串行网络等待。
        if (newReceiptMessageIds.Count > 0)
        {
            await _hubContext.Clients.Group(ChatHub.GroupName(conversationId)).SendAsync("chat:message-read", new
            {
                messageId = newReceiptMessageIds[^1],
                messageIds = newReceiptMessageIds,
                conversationId,
                readByUserId = userId,
                readAt = now
            });
        }

        if (readStateChanged || newReceiptMessageIds.Count > 0)
            await NotifyConversationInboxUpdated(conversationId);

        return Ok(new { lastReadMessageId = membership.LastReadMessageId });
    }

    /// <summary>
    /// 获取指定消息的已读状态详情。
    /// 返回已读用户列表及总阅读人数。
    /// 仅会话成员有权查看。
    /// </summary>
    /// <param name="messageId">消息ID。</param>
    /// <returns>消息已读详情，包含已读用户列表。</returns>
    [HttpGet("messages/{messageId:ulong}/read-status")]
    public async Task<ActionResult<MessageReadDetailDto>> GetMessageReadStatus(ulong messageId)
    {
        var userId = GetUserId();

        // 只为拿到会话 id / 发送者，不需要把 Content / Extra 等大字段读出来再跟踪。
        var message = await _db.ChatMessages
            .AsNoTracking()
            .Where(m => m.Id == messageId)
            .Select(m => new { m.ConversationId, m.SenderUserId })
            .FirstOrDefaultAsync();
        if (message == null)
            return NotFound(new { message = "Message not found" });

        // 妤犲矁鐦夐弶鍐
        var isMember = await _db.ChatConversationMembers
            .AnyAsync(m => m.ConversationId == message.ConversationId
                        && m.UserId == userId
                        && m.LeftAt == null);
        if (!isMember)
            return NotFound(new { message = "Access denied" });

        // 閺屻儴顕楀鑼额嚢閻劍鍩?
        var readUsers = await _db.ChatMessageReceipts
            .AsNoTracking()
            .Where(r => r.MessageId == messageId)
            .Join(_db.Users, r => r.UserId, u => u.Id, (r, u) => new ReadUserDto
            {
                UserId = u.Id,
                NickName = u.NickName,
                AvatarKey = u.AvatarKey,
                ReadAt = r.ReadAt
            })
            .ToListAsync();

        // 鐠侊紕鐣婚幀缁樺复閺€鎯扳偓鍛殶閿涘牊甯撻梽銈呭絺闁浇鈧拑绱?
        var totalRecipients = await _db.ChatConversationMembers
            .CountAsync(m => m.ConversationId == message.ConversationId
                          && m.UserId != message.SenderUserId
                          && m.LeftAt == null);

        return Ok(new MessageReadDetailDto
        {
            MessageId = messageId,
            TotalRecipients = totalRecipients,
            ReadCount = readUsers.Count,
            ReadUsers = readUsers
        });
    }

    /// <summary>
    /// 批量获取会话内多条消息的已读状态。
    /// 前端打开会话时需要展示自己发出的消息的已读进度，
    /// 逐条调用 read-status 会瞬间发出几十个并发请求（挤占并发队列、拖慢发送），
    /// 这里用一次请求返回整段状态。
    /// </summary>
    /// <param name="conversationId">会话ID。</param>
    /// <param name="messageIds">逗号分隔的消息ID；不传则取该会话内自己最近发出的消息。</param>
    /// <returns>消息已读状态列表（仅包含自己发出的消息）。</returns>
    [HttpGet("conversations/{conversationId:ulong}/read-status")]
    public async Task<ActionResult<List<MessageReadDetailDto>>> GetConversationReadStatus(
        ulong conversationId,
        [FromQuery] string? messageIds = null)
    {
        var userId = GetUserId();

        var membership = await _db.ChatConversationMembers
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId && m.UserId == userId && m.LeftAt == null)
            .Select(m => new { m.HistoryClearedBeforeMessageId })
            .FirstOrDefaultAsync();
        if (membership == null)
            return NotFound(new { message = "Conversation not found or access denied" });

        var clearedBefore = membership.HistoryClearedBeforeMessageId ?? 0;

        var requestedIds = new List<ulong>();
        if (!string.IsNullOrWhiteSpace(messageIds))
        {
            foreach (var part in messageIds.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (ulong.TryParse(part, out var parsedId) && parsedId > 0)
                    requestedIds.Add(parsedId);
            }
        }

        var query = _db.ChatMessages
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId && m.SenderUserId == userId)
            .Where(m => m.Id > clearedBefore)
            .Where(m => !m.ChatMessageDeletions.Any(d => d.UserId == userId));

        if (requestedIds.Count > 0)
            query = query.Where(m => requestedIds.Contains(m.Id));

        var messageRows = await query
            .OrderByDescending(m => m.Id)
            .Take(500)
            .Select(m => new { m.Id })
            .ToListAsync();

        if (messageRows.Count == 0)
            return Ok(new List<MessageReadDetailDto>());

        var ids = messageRows.Select(m => m.Id).ToList();

        var receiptRows = await _db.ChatMessageReceipts
            .AsNoTracking()
            .Where(r => ids.Contains(r.MessageId))
            .Join(_db.Users.AsNoTracking(), r => r.UserId, u => u.Id, (r, u) => new
            {
                r.MessageId,
                Dto = new ReadUserDto
                {
                    UserId = u.Id,
                    NickName = u.NickName ?? u.UserAccount ?? string.Empty,
                    AvatarKey = u.AvatarKey,
                    ReadAt = r.ReadAt
                }
            })
            .ToListAsync();

        var readersByMessage = receiptRows
            .GroupBy(r => r.MessageId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Dto).ToList());

        var totalRecipients = await _db.ChatConversationMembers
            .AsNoTracking()
            .CountAsync(m => m.ConversationId == conversationId
                          && m.UserId != userId
                          && m.LeftAt == null);

        var result = messageRows.Select(row =>
        {
            var readers = readersByMessage.TryGetValue(row.Id, out var value)
                ? value
                : new List<ReadUserDto>();

            return new MessageReadDetailDto
            {
                MessageId = row.Id,
                TotalRecipients = totalRecipients,
                ReadCount = readers.Count,
                ReadUsers = readers
            };
        }).ToList();

        return Ok(result);
    }

    /// <summary>
    /// 閺嬪嫬缂撴导姘崇樈閹芥顩﹂幎鏇炲
    /// </summary>
    /// <param name="userId">閻劍鍩汭D</param>
    /// <returns>娴兼俺鐦介幗妯款洣閹舵洖濂栫悰銊ㄦ彧瀵?/returns>
    static Expression<Func<ChatConversation, ConversationSummaryDto>> BuildConversationSummaryProjection(ulong userId)
    {
        return c => new ConversationSummaryDto
        {
            Id = c.Id,
            ConversationType = c.ConversationType,
            IsActive = c.IsActive ?? true,
            UpdatedAt = c.UpdatedAt,
            Title = c.ConversationType == "direct"
                ? c.ChatConversationMembers
                    .Where(m => m.UserId != userId && m.LeftAt == null)
                    .Select(m => m.User.NickName ?? m.User.UserAccount)
                    .FirstOrDefault() ?? c.Title
                : c.Title,
            UserAccount = c.ConversationType == "direct"
                ? c.ChatConversationMembers
                    .Where(m => m.UserId != userId && m.LeftAt == null)
                    .Select(m => m.User.UserAccount)
                    .FirstOrDefault()
                : null,
            AvatarKey = c.ConversationType == "direct"
                ? c.ChatConversationMembers
                    .Where(m => m.UserId != userId && m.LeftAt == null)
                    .Select(m => m.User.AvatarKey)
                    .FirstOrDefault() ?? c.AvatarKey
                : c.AvatarKey,
            AvatarUserId = c.ConversationType == "direct"
                ? c.ChatConversationMembers
                    .Where(m => m.UserId != userId && m.LeftAt == null)
                    .Select(m => (ulong?)m.UserId)
                    .FirstOrDefault()
                : c.OwnerUserId,
            IsPinned = c.ChatConversationMembers
                .Where(m => m.UserId == userId && m.LeftAt == null)
                .Select(m => m.IsPinned)
                .FirstOrDefault(),
            IsMuted = c.ChatConversationMembers
                .Where(m => m.UserId == userId && m.LeftAt == null)
                .Select(m => m.IsMuted)
                .FirstOrDefault()
        };
    }

    async Task<MessageSummaryDto> BuildMessageSummary(ulong messageId)
    {
        return await _db.ChatMessages
            .AsNoTracking()
            .Where(m => m.Id == messageId)
            .Select(m => new MessageSummaryDto
            {
                Id = m.Id,
                SenderUserId = m.MessageType == "system" ? 0UL : m.SenderUserId,
                SenderNickName = m.MessageType == "system" ? "系统" : m.SenderUser.NickName,
                MessageType = m.MessageType,
                Content = m.IsRecalled ? null : m.Content,
                Extra = m.IsRecalled ? null : m.Extra,
                ReplyToMessageId = m.ReplyToMessageId,
                ReplyToMessage = m.ReplyToMessage == null ? null : new MessageReferenceDto
                {
                    Id = m.ReplyToMessage.Id,
                    SenderUserId = m.ReplyToMessage.MessageType == "system" ? 0UL : m.ReplyToMessage.SenderUserId,
                    SenderNickName = m.ReplyToMessage.MessageType == "system" ? "系统" : m.ReplyToMessage.SenderUser.NickName,
                    MessageType = m.ReplyToMessage.MessageType,
                    Content = m.ReplyToMessage.IsRecalled ? null : m.ReplyToMessage.Content,
                    Extra = m.ReplyToMessage.IsRecalled ? null : m.ReplyToMessage.Extra,
                    RecalledByUserId = m.ReplyToMessage.RecalledByUserId,
                    RecallPrompt = m.ReplyToMessage.RecallPrompt,
                    IsRecalled = m.ReplyToMessage.IsRecalled,
                    CreatedAt = m.ReplyToMessage.CreatedAt
                },
                RecalledByUserId = m.RecalledByUserId,
                RecallPrompt = m.RecallPrompt,
                IsRecalled = m.IsRecalled,
                CreatedAt = m.CreatedAt
            })
            .SingleAsync();
    }

    async Task ExpirePendingGroupJoinRequests(ulong? conversationId = null)
    {
        var now = DateTime.UtcNow;
        var query = _db.ChatGroupJoinRequests
            .Where(r => r.RequestStatus == "pending" && r.ExpireAt != null && r.ExpireAt <= now);

        if (conversationId.HasValue)
            query = query.Where(r => r.ConversationId == conversationId.Value);

        var expiredRequests = await query.ToListAsync();
        if (expiredRequests.Count == 0)
            return;

        foreach (var request in expiredRequests)
        {
            request.RequestStatus = "expired";
            request.HandledAt ??= now;
            request.UpdatedAt = now;
        }

        await _db.SaveChangesAsync();
    }

    async Task<GroupJoinRequestDto?> BuildGroupJoinRequestDto(ulong requestId)
    {
        return await _db.ChatGroupJoinRequests
            .AsNoTracking()
            .Where(r => r.Id == requestId)
            .Select(BuildGroupJoinRequestProjection())
            .SingleOrDefaultAsync();
    }

    static Expression<Func<ChatGroupJoinRequest, GroupJoinRequestDto>> BuildGroupJoinRequestProjection()
    {
        return r => new GroupJoinRequestDto
        {
            Id = r.Id,
            ConversationId = r.ConversationId,
            RequesterUserId = r.RequesterUserId,
            RequestMessage = r.RequestMessage,
            RequestStatus = r.RequestStatus,
            HandledByUserId = r.HandledByUserId,
            HandledAt = r.HandledAt,
            RejectReason = r.RejectReason,
            ExpireAt = r.ExpireAt,
            CreatedAt = r.CreatedAt,
            UpdatedAt = r.UpdatedAt,
            Requester = new FriendUserDto
            {
                UserId = r.RequesterUserId,
                UserAccount = r.RequesterUser.UserAccount,
                NickName = r.RequesterUser.NickName,
                AvatarKey = r.RequesterUser.AvatarKey
            }
        };
    }

    /// <summary>
    /// 构建会话详情DTO。
    /// 包含完整的成员信息、群申请计数及好友备注处理。
    /// </summary>
    /// <param name="conversationId">会话ID。</param>
    /// <param name="userId">当前用户ID。</param>
    /// <returns>会话详情对象，若不存在或无权限则返回null。</returns>
    async Task<ConversationDetailDto?> BuildConversationDetail(ulong conversationId, ulong userId)
    {
        var now = DateTime.UtcNow;
        var detail = await _db.ChatConversations
            .AsNoTracking()
            .Where(c => c.Id == conversationId)
            .Select(c => new ConversationDetailDto
            {
                Id = c.Id,
                ConversationType = c.ConversationType,
                Title = c.ConversationType == "direct"
                    ? c.ChatConversationMembers
                        .Where(m => m.UserId != userId && m.LeftAt == null)
                        .Select(m => m.User.NickName ?? m.User.UserAccount)
                        .FirstOrDefault() ?? c.Title
                    : c.Title,
                AvatarKey = c.ConversationType == "direct"
                    ? c.ChatConversationMembers
                        .Where(m => m.UserId != userId && m.LeftAt == null)
                        .Select(m => m.User.AvatarKey)
                        .FirstOrDefault() ?? c.AvatarKey
                    : c.AvatarKey,
                AvatarUserId = c.ConversationType == "direct"
                    ? c.ChatConversationMembers
                        .Where(m => m.UserId != userId && m.LeftAt == null)
                        .Select(m => (ulong?)m.UserId)
                        .FirstOrDefault()
                    : c.OwnerUserId,
                IsActive = c.IsActive ?? true,
                IsPinned = c.ChatConversationMembers
                    .Where(m => m.UserId == userId && m.LeftAt == null)
                    .Select(m => m.IsPinned)
                    .FirstOrDefault(),
                IsMuted = c.ChatConversationMembers
                    .Where(m => m.UserId == userId && m.LeftAt == null)
                    .Select(m => m.IsMuted)
                    .FirstOrDefault(),
                OwnerUserId = c.OwnerUserId,
                CreatedAt = c.CreatedAt,
                UpdatedAt = c.UpdatedAt,
                PendingJoinRequestCount = c.ConversationType == "group"
                    && c.ChatConversationMembers.Any(m =>
                        m.UserId == userId &&
                        m.LeftAt == null &&
                        (m.MemberRole == "owner" || m.MemberRole == "admin"))
                    ? c.ChatGroupJoinRequests.Count(r =>
                        r.RequestStatus == "pending" &&
                        (r.ExpireAt == null || r.ExpireAt > now))
                    : 0,
                FriendRemark = null,
                IsFriend = c.ConversationType != "direct",
                Members = c.ChatConversationMembers
                    .Where(m => m.LeftAt == null)
                    .OrderBy(m => m.JoinedAt)
                    .Select(m => new ConversationMemberDto
                    {
                        UserId = m.UserId,
                        UserAccount = m.User.UserAccount,
                        NickName = m.User.NickName,
                        AvatarKey = m.User.AvatarKey,
                        MemberRole = m.MemberRole,
                        JoinedAt = m.JoinedAt,
                        LastReadMessageId = m.LastReadMessageId,
                        IsMuted = m.MuteMode == "permanent"
                            || (m.MuteMode == "temporary" && m.MuteUntil != null && m.MuteUntil > now),
                        MutedUntil = m.MuteUntil,
                        MutedMode = m.MuteMode
                    })
                    .ToList()
            })
            .SingleOrDefaultAsync();

        if (detail == null || detail.ConversationType != "direct")
            return detail;

        var peerUserId = detail.Members
            .FirstOrDefault(m => m.UserId != userId)
            ?.UserId;

        if (!peerUserId.HasValue)
        {
            detail.IsFriend = false;
            return detail;
        }

        var friendship = await _db.UserFriendships
            .AsNoTracking()
            .Where(f =>
                f.UserId == userId &&
                f.FriendUserId == peerUserId.Value &&
                f.Status == "active")
            .Select(f => new
            {
                f.FriendRemark
            })
            .SingleOrDefaultAsync();

        detail.IsFriend = friendship != null;
        detail.FriendRemark = friendship?.FriendRemark;

        if (!string.IsNullOrWhiteSpace(detail.FriendRemark))
            detail.Title = detail.FriendRemark;

        return detail;
    }

    /// <summary>
    /// 载入会话 + 当前操作者（以及可选的被操作成员）。
    ///
    /// 旧实现无条件 Include 全部成员及成员的用户实体：500 人群里做一次踢人，
    /// 也会把 500 个成员 + 500 个用户实体全部物化并跟踪。调用方真正用到的
    /// 只有「当前成员」和「目标成员」两行，这里用过滤 Include 只取这两行。
    /// </summary>
    async Task<(ChatConversation Conversation, ChatConversationMember CurrentMember)?> GetActiveConversationContext(
        ulong conversationId,
        ulong userId,
        ulong targetMemberUserId = 0)
    {
        var conversation = await _db.ChatConversations
            .Include(c => c.ChatConversationMembers.Where(m => m.UserId == userId || m.UserId == targetMemberUserId))
                .ThenInclude(m => m.User)
            .FirstOrDefaultAsync(c => c.Id == conversationId && c.IsActive == true);

        if (conversation == null)
            return null;

        var currentMember = conversation.ChatConversationMembers
            .FirstOrDefault(m => m.UserId == userId && m.LeftAt == null);

        return currentMember == null ? null : (conversation, currentMember);
    }

    static string NormalizeValue(string? value)
        => (value ?? string.Empty).Trim().ToLowerInvariant();

    static string? NormalizeReason(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    static string GetUserDisplayName(string? nickName, string? userAccount, ulong userId)
        => !string.IsNullOrWhiteSpace(nickName)
            ? nickName.Trim()
            : !string.IsNullOrWhiteSpace(userAccount)
                ? userAccount.Trim()
                : userId.ToString();

    static string FormatMuteDuration(int durationMinutes)
    {
        if (durationMinutes <= 0)
            return "0分钟";

        var days = durationMinutes / (60 * 24);
        var hours = durationMinutes % (60 * 24) / 60;
        var minutes = durationMinutes % 60;
        var parts = new List<string>();

        if (days > 0)
            parts.Add($"{days}天");
        if (hours > 0)
            parts.Add($"{hours}小时");
        if (minutes > 0)
            parts.Add($"{minutes}分钟");

        return parts.Count > 0 ? string.Join(string.Empty, parts) : $"{durationMinutes}分钟";
    }

    static bool IsOwner(ChatConversationMember member)
        => NormalizeValue(member.MemberRole) == "owner";

    static bool CanManageJoinRequests(ChatConversationMember member)
        => NormalizeValue(member.MemberRole) is "owner" or "admin";

    static bool CanModerateMember(ChatConversationMember currentMember, ChatConversationMember targetMember)
    {
        if (currentMember.UserId == targetMember.UserId)
            return false;

        var currentRole = NormalizeValue(currentMember.MemberRole);
        var targetRole = NormalizeValue(targetMember.MemberRole);

        return currentRole switch
        {
            "owner" => targetRole != "owner",
            "admin" => targetRole == "member",
            _ => false
        };
    }

    static bool IsGroupMuteActive(ChatConversationMember member, DateTime now)
    {
        var muteMode = NormalizeValue(member.MuteMode);
        return muteMode == "permanent"
            || (muteMode == "temporary" && member.MuteUntil != null && member.MuteUntil > now);
    }

    static string? NormalizeGroupJoinRequestStatus(string? value)
        => NormalizeValue(value) switch
        {
            "pending" => "pending",
            "approved" => "approved",
            "rejected" => "rejected",
            "expired" => "expired",
            _ => null
        };

    async Task<bool> AreUsersFriends(ulong userId, ulong peerUserId)
    {
        return await _db.UserFriendships
            .AsNoTracking()
            .AnyAsync(f =>
                f.UserId == userId &&
                f.FriendUserId == peerUserId &&
                f.Status == "active");
    }

    /// <summary>
    /// blockerUserId 是否拉黑了 blockedUserId。
    /// </summary>
    async Task<bool> IsBlockedBy(ulong blockerUserId, ulong blockedUserId)
    {
        return await _db.UserBlocks
            .AsNoTracking()
            .AnyAsync(b =>
                b.UserId == blockerUserId &&
                b.BlockedUserId == blockedUserId);
    }

    async Task<HashSet<ulong>> GetActiveFriendUserIds(ulong userId, IEnumerable<ulong> candidateUserIds)
    {
        var normalizedCandidateIds = candidateUserIds
            .Where(id => id != 0 && id != userId)
            .Distinct()
            .ToList();

        if (normalizedCandidateIds.Count == 0)
            return [];

        var friendUserIds = await _db.UserFriendships
            .AsNoTracking()
            .Where(f =>
                f.UserId == userId &&
                f.Status == "active" &&
                normalizedCandidateIds.Contains(f.FriendUserId))
            .Select(f => f.FriendUserId)
            .ToListAsync();

        return friendUserIds.ToHashSet();
    }

    ChatMessage CreateSystemMessage(ulong conversationId, ulong senderUserId, string content, DateTime now)
    {
        var message = new ChatMessage
        {
            ConversationId = conversationId,
            SenderUserId = senderUserId,
            MessageType = "system",
            Content = content,
            IsRecalled = false,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.ChatMessages.Add(message);
        return message;
    }

    void AddGroupActionLog(
        ulong conversationId,
        string actionType,
        ulong? operatorUserId,
        ulong? targetUserId,
        string? actionReason,
        object? actionPayload = null,
        ChatMessage? relatedMessage = null)
    {
        //_db.ChatGroupActionLogs.Add(new ChatGroupActionLog
        //{
        //    ConversationId = conversationId,
        //    ActionType = actionType,
        //    OperatorUserId = operatorUserId,
        //    TargetUserId = targetUserId,
        //    ActionReason = actionReason,
        //    ActionPayload = actionPayload == null ? null : JsonSerializer.Serialize(actionPayload),
        //    RelatedMessage = relatedMessage,
        //    CreatedAt = DateTime.UtcNow
        //});
    }

    async Task BroadcastSystemMessage(ChatMessage message, DateTime now)
    {
        // 系统消息同样意味着「会话又有新内容了」，隐藏的会话应重新出现在收件箱。
        await UnhideConversationForMembers(message.ConversationId, now);

        var summary = await BuildMessageSummary(message.Id);
        await _hubContext.Clients.Group(ChatHub.GroupName(message.ConversationId)).SendAsync("chat:message-updated", new
        {
            conversationId = message.ConversationId,
            messageId = message.Id,
            messageType = message.MessageType,
            createdAt = now,
            action = "create",
            message = summary
        });
        await NotifyConversationInboxUpdated(message.ConversationId);
    }

    /// <summary>
    /// 收到新内容时，把「被用户删除后隐藏」的会话重新放回收件箱。
    /// 只清 is_hidden，历史的清除游标保留。
    /// </summary>
    async Task UnhideConversationForMembers(ulong conversationId, DateTime now)
    {
        var hiddenMemberships = await _db.ChatConversationMembers
            .Where(m => m.ConversationId == conversationId && m.LeftAt == null && m.IsHidden)
            .ToListAsync();

        if (hiddenMemberships.Count == 0)
            return;

        foreach (var membership in hiddenMemberships)
        {
            membership.IsHidden = false;
            membership.UpdatedAt = now;
        }

        await _db.SaveChangesAsync();
    }

    async Task NotifyConversationInboxUpdated(ulong conversationId)
    {
        var memberUserIds = await _db.ChatConversationMembers
            .AsNoTracking()
            .Where(m => m.ConversationId == conversationId && m.LeftAt == null)
            .Select(m => m.UserId)
            .Distinct()
            .ToListAsync();

        if (memberUserIds.Count == 0)
            return;

        await _hubContext.Clients.Groups(memberUserIds.Select(ChatHub.UserGroupName).ToList()).SendAsync("chat:inbox-updated", new
        {
            conversationId,
            updatedAt = DateTime.UtcNow
        });
    }

    /// <summary>
    /// 从JWT令牌中提取当前登录用户的ID。
    /// 支持多种Claim类型以确保兼容性。
    /// </summary>
    /// <returns>用户唯一标识符（ulong）。</returns>
    ulong GetUserId()
    {
        var candidateTypes = new[] { ClaimTypes.NameIdentifier, "sub", "nameid", "user_id", "id" };

        foreach (var type in candidateTypes)
        {
            var val = User.FindFirstValue(type);
            if (!string.IsNullOrEmpty(val))
            {
                if (ulong.TryParse(val, out var id))
                    return id;

                throw new InvalidOperationException($"Unable to parse user ID from claim '{type}' with value '{val}'");
            }
        }

        throw new InvalidOperationException("User ID claim was not found in the token");
    }
}

