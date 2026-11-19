using api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

namespace api.Infrastructure;

public interface IFileService
{
    Task<string> SaveImageAsync(ulong userId, IFormFile file, bool isPublic, CancellationToken cancellationToken = default);
    Task<string> SaveUserAvatarAsync(ulong userId, IFormFile file, IFormFile? thumbnail = null, CancellationToken cancellationToken = default);
    Task<string> SaveProfileBackgroundAsync(ulong userId, IFormFile file, IFormFile? thumbnail = null, CancellationToken cancellationToken = default);
    Task<(Stream Stream, string ContentType)?> GetImageAsync(ulong userId, string fileKey, bool isPublic, bool preferThumbnail = false, CancellationToken cancellationToken = default);
    Task<FileInfoResult> SaveChatFileAsync(ulong userId, ulong conversationId, IFormFile file, CancellationToken cancellationToken = default);
    Task<(Stream Stream, string ContentType, string FileName)?> GetChatFileAsync(ulong userId, string fileKey, CancellationToken cancellationToken = default);
    Task<string> SaveConversationAvatarAsync(ulong userId, ulong conversationId, IFormFile file, IFormFile? thumbnail = null, CancellationToken cancellationToken = default);
    Task<(Stream Stream, string ContentType)?> GetConversationAvatarAsync(ulong userId, ulong conversationId, string fileKey, bool preferThumbnail = false, CancellationToken cancellationToken = default);
    Task<(Stream Stream, string ContentType)?> GetPublicConversationAvatarAsync(ulong conversationId, string fileKey, bool preferThumbnail = false, CancellationToken cancellationToken = default);
}

public class FileInfoResult
{
    public string FileKey { get; set; } = string.Empty;
    public string OriginalFileName { get; set; } = string.Empty;
    public long FileSize { get; set; }
    public string ContentType { get; set; } = string.Empty;
}

public class LocalFileService : IFileService
{
    private readonly IWebHostEnvironment _env;
    private readonly DailyCheckDbContext _db;

    private const long MaxImageBytes = 10 * 1024 * 1024;          // 10 MB
    // 背景图保留原像素后文件可能明显大于头像；背景图单独放宽到 20MB（与控制器的 RequestSizeLimit 对齐），
    // 其它上传接口仍使用 MaxImageBytes = 10MB。
    private const long MaxProfileBackgroundBytes = 20 * 1024 * 1024; // 20 MB
    private const long MaxChatFileBytes = 100 * 1024 * 1024;      // 100 MB
    private const int AvatarThumbnailMaxPixels = 96;
    private const string AvatarThumbnailSuffix = "_thumb";
    // 个人主页背景图保留客户端 1:1 裁剪后的原始像素，只做 WebP 格式转换；
    // 这里仅设安全上限，避免超大图解码耗尽内存（正常手机照片最长边 ≈3024，远低于上限）。
    private const int ProfileBackgroundMaxDimension = 8192;
    private const string ProfileBackgroundTooLargeMessage = "背景图尺寸过大（最长边不能超过 8192px）";
    // 背景图是有损照片类内容，保留原像素时 85 质量肉眼几乎无损，体积远小于无损/默认编码。
    private const int ProfileBackgroundWebpQuality = 85;
    // 背景缩略占位图：前端先显示它、原图下载完再淡入（渐进加载），128px 足够铺满卡片当模糊底。
    private const int ProfileBackgroundThumbnailMaxPixels = 128;
    private const int ProfileBackgroundThumbnailWebpQuality = 70;

    private static readonly string[] AllowedImageExtensions =
    [
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
        // iPhone 相册默认格式；服务端会解码后统一转成 WebP
        ".heic", ".heif", ".hif"
    ];

    private static readonly Dictionary<string, string> SupportedFileTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        // 图片
        { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".png", "image/png" },
        { ".gif", "image/gif" }, { ".webp", "image/webp" }, { ".bmp", "image/bmp" },
        { ".heic", "image/heic" }, { ".heif", "image/heif" }, { ".hif", "image/heif" },
        { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" },
        // 视频
        { ".mp4", "video/mp4" }, { ".avi", "video/x-msvideo" }, { ".mov", "video/quicktime" },
        { ".wmv", "video/x-ms-wmv" }, { ".flv", "video/x-flv" }, { ".mkv", "video/x-matroska" },
        { ".webm", "video/webm" }, { ".m4v", "video/x-m4v" },
        // 音频
        { ".mp3", "audio/mpeg" }, { ".wav", "audio/wav" }, { ".ogg", "audio/ogg" },
        { ".m4a", "audio/mp4" }, { ".flac", "audio/flac" }, { ".aac", "audio/aac" },
        { ".wma", "audio/x-ms-wma" }, { ".opus", "audio/opus" },
        // 文档
        { ".pdf", "application/pdf" }, { ".doc", "application/msword" },
        { ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        { ".xls", "application/vnd.ms-excel" },
        { ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        { ".ppt", "application/vnd.ms-powerpoint" },
        { ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
        { ".txt", "text/plain" }, { ".rtf", "application/rtf" },
        { ".csv", "text/csv" }, { ".md", "text/markdown" },
        // 压缩包
        { ".zip", "application/zip" }, { ".rar", "application/x-rar-compressed" },
        { ".7z", "application/x-7z-compressed" }, { ".tar", "application/x-tar" },
        { ".gz", "application/gzip" }, { ".bz2", "application/x-bzip2" },
        // 代码/文本
        { ".json", "application/json" }, { ".xml", "application/xml" },
        { ".html", "text/html" }, { ".css", "text/css" },
        { ".js", "application/javascript" }, { ".ts", "application/typescript" }
    };

    public LocalFileService(IWebHostEnvironment env, DailyCheckDbContext db)
    {
        _env = env;
        _db = db;
    }

    #region Image (Public/Private)

    public async Task<string> SaveImageAsync(ulong userId, IFormFile file, bool isPublic, CancellationToken cancellationToken = default)
    {
        ValidateImageFile(file);

        var root = GetUserRoot(userId, isPublic);
        Directory.CreateDirectory(root);

        // 计算 SHA256 并保存为 WebP（只读一次流）
        var (_, fileKey) = await ComputeHashAndSaveWebpAsync(file, root, cancellationToken);
        return fileKey;
    }

    public async Task<string> SaveUserAvatarAsync(ulong userId, IFormFile file, IFormFile? thumbnail = null, CancellationToken cancellationToken = default)
    {
        ValidateImageFile(file);
        if (thumbnail != null)
            ValidateImageFile(thumbnail);

        var root = GetUserRoot(userId, isPublic: true);
        Directory.CreateDirectory(root);

        var (_, fileKey) = await ComputeHashAsync(file.OpenReadStream(), cancellationToken);
        await SaveAvatarAssetsAsync(file, thumbnail, root, fileKey, cancellationToken);
        return fileKey;
    }

    /// <summary>
    /// 保存个人主页背景图：与头像共用公开用户目录（便于复用
    /// GET /mm/Files/users/{userId}/{key} 公开读取）。
    ///
    /// 保留客户端 1:1 裁剪后的**原始像素**（服务端不缩放），只做格式转换与缩略图：
    /// · 输入已是 WebP：原样落盘（零重编码，像素 / 画质无损）；
    /// · 其它格式（jpg/png/heic/gif 等）：解码后以 WebP 质量 85 编码，保留原始分辨率；
    /// · 最长边安全上限 8192px，超限抛异常「背景图尺寸过大（最长边不能超过 8192px）」；
    /// · 同时预处理缩略占位图（最长边 ≤128px，存为 {key}_thumb.webp）供前端渐进加载：
    ///   优先使用客户端上传的 thumbnail，未上传则由服务端从原图自动生成。
    ///
    /// 实现注意（2026-11-18）：大图转码采用「只解码一次 + Rgba32 编码」。
    /// ImageSharp 3.1.12 在 Android/arm64 上对 3 字节 RGB 图做 WebP 有损编码时，
    /// 会走到 `Pad3Shuffle4` 的 SIMD 通道填充路径（曾在 3000×3000 背景图上触发
    /// native SIGSEGV 直接终止进程）；先转 Rgba32 再编码可绕开该路径，
    /// 同时主图与缩略图共用一次解码结果，显著降低内存峰值（原实现会整图解码两次）。
    /// </summary>
    public async Task<string> SaveProfileBackgroundAsync(ulong userId, IFormFile file, IFormFile? thumbnail = null, CancellationToken cancellationToken = default)
    {
        ValidateImageFile(file, MaxProfileBackgroundBytes);
        if (thumbnail != null)
            ValidateImageFile(thumbnail);

        var root = GetUserRoot(userId, isPublic: true);
        Directory.CreateDirectory(root);

        var (_, fileKey) = await ComputeHashAsync(file.OpenReadStream(), cancellationToken);
        var webpPath = Path.Combine(root, fileKey + ".webp");
        var thumbnailPath = Path.Combine(root, fileKey + AvatarThumbnailSuffix + ".webp");

        // 内容哈希相同即内容相同，直接复用，避免重复转码。
        var needMain = !File.Exists(webpPath);
        var needThumb = !File.Exists(thumbnailPath);
        if (!needMain && !needThumb)
            return fileKey;

        var originalExt = Path.GetExtension(file.FileName).ToLowerInvariant();

        Image? decodedImage = null;
        try
        {
            // 1) 已是 WebP：只读文件头校验尺寸后原样复制（零重编码，像素/画质无损）。
            if (needMain && originalExt == ".webp")
            {
                await ValidateProfileBackgroundSourceAsync(file, cancellationToken);
                try
                {
                    await using var sourceStream = file.OpenReadStream();
                    await using var targetStream = new FileStream(webpPath, FileMode.CreateNew, FileAccess.Write);
                    await sourceStream.CopyToAsync(targetStream, cancellationToken);
                }
                catch (IOException) when (File.Exists(webpPath))
                {
                    // 并发上传同一内容时目标文件已存在，复用即可。
                }

                needMain = false;
            }

            // 2) 非 WebP 主图 / 需要服务端生成缩略图：整图只解码一次，主图与缩略图共用。
            if (needMain || (needThumb && thumbnail == null))
            {
                decodedImage = await LoadImageForConversionAsync(file.OpenReadStream(), originalExt, cancellationToken);
                EnsureProfileBackgroundDimensionWithinLimit(decodedImage.Width, decodedImage.Height);

                if (needThumb && thumbnail == null)
                {
                    await SaveProfileBackgroundThumbnailFromImageAsync(decodedImage, thumbnailPath, cancellationToken);
                    needThumb = false;
                }
            }

            // 3) 主图：不缩放，仅转 WebP（Rgba32 编码避开 3 字节 RGB 的 SIMD 填充路径）。
            if (needMain)
            {
                using var rgba = decodedImage!.CloneAs<Rgba32>();
                await SaveImageAsWebpDirectAsync(rgba, webpPath, cancellationToken, ProfileBackgroundWebpQuality);
            }
        }
        finally
        {
            decodedImage?.Dispose();
        }

        // 4) 客户端上传了缩略图：直接缩放落盘（只缩不放）。
        if (needThumb && thumbnail != null)
            await SaveImageAsWebpAsync(
                thumbnail, thumbnailPath, cancellationToken,
                ProfileBackgroundThumbnailMaxPixels, ProfileBackgroundThumbnailMaxPixels,
                onlyDownscale: true,
                webpQuality: ProfileBackgroundThumbnailWebpQuality);

        return fileKey;
    }

    public Task<(Stream Stream, string ContentType)?> GetImageAsync(ulong userId, string fileKey, bool isPublic, bool preferThumbnail = false, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(fileKey))
            return Task.FromResult<(Stream, string)?>(null);

        fileKey = Path.GetFileName(fileKey); // 防目录遍历
        var root = GetUserRoot(userId, isPublic);

        var lookupKey = preferThumbnail ? BuildAvatarThumbnailKey(fileKey) : fileKey;
        var (filePath, extension) = GetFilePathWithFallback(root, lookupKey, AllowedImageExtensions, defaultExtension: ".webp");
        if (preferThumbnail && !File.Exists(filePath))
            (filePath, extension) = GetFilePathWithFallback(root, fileKey, AllowedImageExtensions, defaultExtension: ".webp");

        if (!File.Exists(filePath))
            return Task.FromResult<(Stream, string)?>(null);

        var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        var contentType = GetMimeType(extension);
        return Task.FromResult<(Stream, string)?>((stream, contentType));
    }

    #endregion

    #region Chat File

    /// <inheritdoc/>
    public async Task<FileInfoResult> SaveChatFileAsync(ulong userId, ulong conversationId, IFormFile file, CancellationToken cancellationToken = default)
    {
        ValidateChatFile(file);
        await EnsureUserIsConversationMember(userId, conversationId, cancellationToken);

        var originalExtension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!SupportedFileTypes.ContainsKey(originalExtension))
            throw new InvalidOperationException($"不支持的文件类型：{originalExtension}");

        var root = GetChatRoot(conversationId);
        Directory.CreateDirectory(root);

        var isImage = AllowedImageExtensions.Contains(originalExtension);
        var (hash, _) = await ComputeHashAsync(file.OpenReadStream(), cancellationToken);

        // fileKey 必须带**会话作用域**，两个原因：
        //   1. 物理文件本来就按会话分目录（uploads/chat/{conversationId}/）；
        //   2. chat_file_records 上的 ux_chat_file_records_file_key 是**全局**唯一索引，
        //      而 GetChatFileAsync 也是「按 fileKey 单键查询」—— fileKey 天生要求全局唯一。
        //
        // 历史缺陷（这就是本次修的 500）：图片的 fileKey 原来就是内容哈希本身，于是
        //   · 同一张图在同一会话里发第二次 → 撞唯一索引 → 500「上传失败」；
        //   · 同一张图发到**另一个**会话 → 一样撞索引 → 500（哪怕两份物理文件分目录存得好好的）。
        // 顺带：原来那句「文件已存在」的预检比的是 file.FileName（用户原始文件名），
        // 而真正入库的是哈希，两者永远不相等 —— 等于什么也没检查。
        var fileKey = BuildChatFileKey(conversationId, hash, isImage, originalExtension);
        var contentType = isImage ? "image/webp" : SupportedFileTypes[originalExtension];

        // 同一份字节在同一会话里再传一次是**幂等**的：复用已有记录，
        // 既不报错，也不会多存一份物理文件、多插一条元数据。
        var existing = await _db.ChatFileRecords
            .FirstOrDefaultAsync(x => x.FileKey == fileKey, cancellationToken);
        if (existing != null)
            return await ReuseChatFileRecordAsync(existing, file, root, fileKey, isImage, contentType, cancellationToken);

        var storedPath = BuildChatStoragePath(root, fileKey, isImage);
        var fileSize = isImage
            ? await SaveChatImageAsync(file, storedPath, cancellationToken)
            : await SaveChatBinaryAsync(file, storedPath, cancellationToken);

        // 插入元数据记录
        var record = new ChatFileRecord
        {
            FileKey = fileKey,
            ConversationId = conversationId,
            UploaderUserId = userId,
            // 列里存**带扩展名的完整文件名**（用于追查是哪次上传）；返回给前端的显示名
            // 仍沿用旧约定（不带扩展名），见 ToFileInfoResult。
            OriginalFilename = Path.GetFileName(file.FileName),
            FileSize = (ulong)fileSize,
            ContentType = contentType,
            IsDeleted = false,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.ChatFileRecords.Add(record);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // 并发上传同一份文件：唯一索引挡住了第二条记录，以库里已存在的那条为准（依旧幂等）
            _db.Entry(record).State = EntityState.Detached;
            var survivor = await _db.ChatFileRecords.AsNoTracking()
                .FirstOrDefaultAsync(x => x.FileKey == fileKey, cancellationToken);
            if (survivor == null)
                throw;

            return ToFileInfoResult(survivor, file.FileName);
        }

        return ToFileInfoResult(record, file.FileName);
    }

    /// <summary>
    /// 生成聊天文件的 fileKey（**带会话作用域**）。
    ///
    ///   · 图片：{会话}_{内容哈希}            物理文件是 {fileKey}.webp（图片统一转 webp）
    ///   · 其它：{会话}_{内容哈希}{原始后缀}  物理文件名就是 fileKey，后缀保留下来，
    ///                                       GetChatFileAsync 才能按后缀给出正确的 Content-Type
    ///
    /// 长度：会话 id ≤ 20 位 + 下划线 + 64 位哈希 + 后缀 ≤ 10 位，远低于列的 128 上限。
    /// </summary>
    private static string BuildChatFileKey(ulong conversationId, string hash, bool isImage, string extension) =>
        isImage ? $"{conversationId}_{hash}" : $"{conversationId}_{hash}{extension}";

    private static string BuildChatStoragePath(string root, string fileKey, bool isImage) =>
        Path.Combine(root, isImage ? fileKey + ".webp" : fileKey);

    /// <summary>
    /// 把上传图片统一落成 webp。目标文件已存在（内容哈希相同 = 字节相同）就直接复用，
    /// 不再重写一遍。
    /// </summary>
    private static async Task<long> SaveChatImageAsync(IFormFile file, string targetPath, CancellationToken cancellationToken)
    {
        if (!File.Exists(targetPath))
            await SaveImageAsWebpAsync(file, targetPath, cancellationToken);

        return new FileInfo(targetPath).Length;
    }

    /// <summary>
    /// 非图片文件原样落盘（fileKey 就是物理文件名）。同名文件已存在则直接复用 ——
    /// 能落到这一步说明内容哈希一致，字节也一致。
    /// </summary>
    private static async Task<long> SaveChatBinaryAsync(IFormFile file, string targetPath, CancellationToken cancellationToken)
    {
        if (File.Exists(targetPath))
            return new FileInfo(targetPath).Length;

        try
        {
            await using var sourceStream = file.OpenReadStream();
            await using var fileStream = new FileStream(targetPath, FileMode.CreateNew, FileAccess.Write);
            await sourceStream.CopyToAsync(fileStream, cancellationToken);
            return fileStream.Length;
        }
        catch (IOException) when (File.Exists(targetPath))
        {
            // 并发上传同一份内容：另一路请求已经落盘，按实际文件大小记账即可
            return new FileInfo(targetPath).Length;
        }
    }

    /// <summary>
    /// 复用「同内容」的已有记录：补齐可能被清理掉的物理文件、复活软删除记录，
    /// 然后把文件信息原样返回。调用方拿到的是同一个 fileKey，发的第二条消息照样能显示。
    /// </summary>
    private async Task<FileInfoResult> ReuseChatFileRecordAsync(
        ChatFileRecord record,
        IFormFile file,
        string root,
        string fileKey,
        bool isImage,
        string contentType,
        CancellationToken cancellationToken)
    {
        var storedPath = BuildChatStoragePath(root, fileKey, isImage);

        var fileSize = isImage
            ? await SaveChatImageAsync(file, storedPath, cancellationToken)
            : await SaveChatBinaryAsync(file, storedPath, cancellationToken);

        record.FileSize = (ulong)fileSize;
        record.ContentType = contentType;
        record.IsDeleted = false;
        record.OriginalFilename ??= Path.GetFileName(file.FileName);
        record.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);

        return ToFileInfoResult(record, file.FileName);
    }

    private static FileInfoResult ToFileInfoResult(ChatFileRecord record, string uploadedFileName) => new()
    {
        FileKey = record.FileKey,
        // 沿用前端既有约定：展示名不带扩展名（前端按 fileUrl / fileKey 自己判断类型）
        OriginalFileName = Path.GetFileNameWithoutExtension(uploadedFileName),
        FileSize = (long)record.FileSize,
        ContentType = record.ContentType
    };

    public async Task<(Stream Stream, string ContentType, string FileName)?> GetChatFileAsync(ulong userId, string fileKey, CancellationToken cancellationToken = default)
    {
        // 通过 fileKey 查询记录
        var record = await _db.ChatFileRecords
            .AsNoTracking()
            .FirstOrDefaultAsync(f => f.FileKey == fileKey && !f.IsDeleted, cancellationToken);

        if (record == null)
            return null;

        // 验证用户是否是会话成员
        var isMember = await _db.ChatConversationMembers
            .AnyAsync(m => m.ConversationId == record.ConversationId
                        && m.UserId == userId
                        && m.LeftAt == null, cancellationToken);

        if (!isMember)
            return null; // 无权限

        // 构造物理路径并返回文件流
        var root = GetChatRoot(record.ConversationId);

        var (filePath, extension) = GetFilePathWithFallback(root, fileKey, AllowedImageExtensions, defaultExtension: ".webp");
        if (!File.Exists(filePath))
            return null;

        var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        var contentType = GetMimeType(extension);
        return (stream, contentType, fileKey);
    }

    #endregion

    #region Conversation Avatar

    public async Task<string> SaveConversationAvatarAsync(ulong userId, ulong conversationId, IFormFile file, IFormFile? thumbnail = null, CancellationToken cancellationToken = default)
    {
        ValidateImageFile(file);
        if (thumbnail != null)
            ValidateImageFile(thumbnail);

        await EnsureUserIsConversationMember(userId, conversationId, cancellationToken);

        var root = GetConversationAvatarRoot(conversationId);
        Directory.CreateDirectory(root);

        var (_, fileKey) = await ComputeHashAsync(file.OpenReadStream(), cancellationToken);
        await SaveAvatarAssetsAsync(file, thumbnail, root, fileKey, cancellationToken);
        return fileKey;
    }

    public async Task<(Stream Stream, string ContentType)?> GetConversationAvatarAsync(ulong userId, ulong conversationId, string fileKey, bool preferThumbnail = false, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(fileKey))
            return null;

        await EnsureUserIsConversationMember(userId, conversationId, cancellationToken);

        fileKey = Path.GetFileName(fileKey);
        var root = GetConversationAvatarRoot(conversationId);
        var lookupKey = preferThumbnail ? BuildAvatarThumbnailKey(fileKey) : fileKey;
        var (filePath, extension) = GetFilePathWithFallback(root, lookupKey, AllowedImageExtensions, defaultExtension: ".webp");
        if (preferThumbnail && !File.Exists(filePath))
            (filePath, extension) = GetFilePathWithFallback(root, fileKey, AllowedImageExtensions, defaultExtension: ".webp");

        if (!File.Exists(filePath))
            return null;

        var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        var contentType = GetMimeType(extension);
        return (stream, contentType);
    }

    public async Task<(Stream Stream, string ContentType)?> GetPublicConversationAvatarAsync(ulong conversationId, string fileKey, bool preferThumbnail = false, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(fileKey))
            return null;

        fileKey = Path.GetFileName(fileKey);
        var root = GetConversationAvatarRoot(conversationId);
        var lookupKey = preferThumbnail ? BuildAvatarThumbnailKey(fileKey) : fileKey;
        var (filePath, extension) = GetFilePathWithFallback(root, lookupKey, AllowedImageExtensions, defaultExtension: ".webp");
        if (preferThumbnail && !File.Exists(filePath))
            (filePath, extension) = GetFilePathWithFallback(root, fileKey, AllowedImageExtensions, defaultExtension: ".webp");

        if (!File.Exists(filePath))
            return null;

        Stream stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        var contentType = GetMimeType(extension);
        await Task.CompletedTask;
        return (stream, contentType);
    }

    #endregion

    #region Private Helpers

    private string GetUserRoot(ulong userId, bool isPublic)
    {
        var basePath = Path.Combine(_env.ContentRootPath, "uploads");
        return isPublic
            ? Path.Combine(basePath, "public", "users", userId.ToString())
            : Path.Combine(basePath, "users", userId.ToString(), "encrypted");
    }

    private string GetChatRoot(ulong conversationId) =>
        Path.Combine(_env.ContentRootPath, "uploads", "chat", conversationId.ToString());

    private string GetConversationAvatarRoot(ulong conversationId) =>
        Path.Combine(GetChatRoot(conversationId), "avatars");

    private static void ValidateImageFile(IFormFile file, long? maxBytes = null)
    {
        if (file == null || file.Length == 0)
            throw new InvalidOperationException("文件不能为空");

        // 背景图因保留原像素单独放宽到 20MB；其余上传接口沿用默认 10MB。
        var limit = maxBytes ?? MaxImageBytes;
        if (file.Length > limit)
            throw new InvalidOperationException($"图片大小超过限制（最大 {limit / 1024 / 1024} MB）");

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!AllowedImageExtensions.Contains(ext))
            throw new InvalidOperationException("仅支持 JPG/PNG/GIF/WebP/BMP/HEIC 等常见图片格式");
    }

    /// <summary>
    /// 背景图解码 / 直通落盘前的尺寸校验：非 HEIC 输入用 Identify 只读文件头取宽高，
    /// 最长边超过 <see cref="ProfileBackgroundMaxDimension"/> 直接拒绝，避免无谓的大图解码。
    /// </summary>
    private static async Task ValidateProfileBackgroundSourceAsync(IFormFile file, CancellationToken cancellationToken)
    {
        try
        {
            await using var sourceStream = file.OpenReadStream();
            var info = await Image.IdentifyAsync(sourceStream, cancellationToken);
            EnsureProfileBackgroundDimensionWithinLimit(info.Width, info.Height);
        }
        catch (InvalidOperationException)
        {
            throw;
        }
        catch (Exception)
        {
            // 识别失败的图片交给后续解码路径统一报「图片处理失败」，保持既有错误文案。
            throw new InvalidOperationException("图片处理失败");
        }
    }

    /// <summary>
    /// 从已解码的原图生成背景缩略占位图（最长边 ≤128px、只缩不放），落盘为 WebP。
    /// 与主图共用同一次解码结果，不再二次解码原图（降低大图内存峰值）。
    /// </summary>
    private static async Task SaveProfileBackgroundThumbnailFromImageAsync(Image image, string targetPath, CancellationToken cancellationToken)
    {
        using var thumbnail = image.Clone(context =>
        {
            if (image.Width > ProfileBackgroundThumbnailMaxPixels || image.Height > ProfileBackgroundThumbnailMaxPixels)
            {
                context.Resize(new ResizeOptions
                {
                    Mode = ResizeMode.Max,
                    Size = new Size(ProfileBackgroundThumbnailMaxPixels, ProfileBackgroundThumbnailMaxPixels)
                });
            }
        });

        using var rgba = thumbnail.CloneAs<Rgba32>();
        await SaveImageAsWebpDirectAsync(rgba, targetPath, cancellationToken, ProfileBackgroundThumbnailWebpQuality);
    }

    /// <summary>
    /// 把已解码图像有损编码为 WebP 并落盘。
    /// 并发同名内容上传时目标文件已存在即复用；其它失败清理半截文件后抛「图片处理失败」。
    /// </summary>
    private static async Task SaveImageAsWebpDirectAsync(Image image, string targetPath, CancellationToken cancellationToken, int quality)
    {
        try
        {
            await image.SaveAsWebpAsync(
                targetPath,
                new WebpEncoder { FileFormat = WebpFileFormatType.Lossy, Quality = quality },
                cancellationToken);
        }
        catch (IOException) when (File.Exists(targetPath))
        {
            // 并发上传同一内容：文件已落盘即可复用。
        }
        catch
        {
            TryDeleteFile(targetPath);
            throw new InvalidOperationException("图片处理失败");
        }
    }

    /// <summary>最长边安全上限校验（背景图保留原像素，仅防超大图）。</summary>
    private static void EnsureProfileBackgroundDimensionWithinLimit(int width, int height)
    {
        if (width > ProfileBackgroundMaxDimension || height > ProfileBackgroundMaxDimension)
            throw new InvalidOperationException(ProfileBackgroundTooLargeMessage);
    }

    /// <summary>尽力删除文件（清理失败不影响主错误抛出）。</summary>
    private static void TryDeleteFile(string path)
    {
        try { File.Delete(path); } catch { /* ignore cleanup failures */ }
    }

    private static void ValidateChatFile(IFormFile file)
    {
        if (file == null || file.Length == 0)
            throw new InvalidOperationException("文件不能为空");
        if (file.Length > MaxChatFileBytes)
            throw new InvalidOperationException($"文件大小超过限制（最大 {MaxChatFileBytes / 1024 / 1024} MB）");
    }

    private async Task EnsureUserIsConversationMember(ulong userId, ulong conversationId, CancellationToken cancellationToken)
    {
        var isMember = await _db.ChatConversationMembers
            .AnyAsync(m => m.ConversationId == conversationId
                           && m.UserId == userId
                           && m.LeftAt == null, cancellationToken);
        if (!isMember)
            throw new InvalidOperationException("您不是该会话的成员，无权执行此操作");
    }

    private static async Task<(string Hash, string FileKey)> ComputeHashAsync(Stream stream, CancellationToken cancellationToken)
    {
        using var sha256 = SHA256.Create();
        var hashBytes = await sha256.ComputeHashAsync(stream, cancellationToken);
        var hash = Convert.ToHexString(hashBytes).ToLowerInvariant();
        return (hash, hash);
    }

    private async Task<(string Hash, string FileKey)> ComputeHashAndSaveWebpAsync(
        IFormFile file, string targetDirectory, CancellationToken cancellationToken)
    {
        // 计算哈希（先读流）
        var (hash, fileKey) = await ComputeHashAsync(file.OpenReadStream(), cancellationToken);
        var webpPath = Path.Combine(targetDirectory, fileKey + ".webp");

        // 文件已存在（内容哈希相同 = 字节相同）则直接复用
        if (File.Exists(webpPath))
            return (hash, fileKey);

        // 不存在则转换并保存；HEIC/HEIF 的解码分支在 SaveImageAsWebpAsync 里统一处理
        await SaveImageAsWebpAsync(file, webpPath, cancellationToken);

        return (hash, fileKey);
    }

    private async Task SaveAvatarAssetsAsync(
        IFormFile originalFile,
        IFormFile? thumbnailFile,
        string targetDirectory,
        string fileKey,
        CancellationToken cancellationToken)
    {
        var originalPath = Path.Combine(targetDirectory, fileKey + ".webp");
        if (!File.Exists(originalPath))
            await SaveImageAsWebpAsync(originalFile, originalPath, cancellationToken);

        var thumbnailPath = Path.Combine(targetDirectory, BuildAvatarThumbnailKey(fileKey) + ".webp");
        if (!File.Exists(thumbnailPath))
            await SaveImageAsWebpAsync(
                thumbnailFile ?? originalFile,
                thumbnailPath,
                cancellationToken,
                AvatarThumbnailMaxPixels,
                AvatarThumbnailMaxPixels);
    }

    private static string BuildAvatarThumbnailKey(string fileKey)
    {
        var sanitized = Path.GetFileName(fileKey);
        if (string.IsNullOrWhiteSpace(sanitized))
            return sanitized;

        return Path.HasExtension(sanitized)
            ? $"{Path.GetFileNameWithoutExtension(sanitized)}{AvatarThumbnailSuffix}"
            : sanitized + AvatarThumbnailSuffix;
    }

    private static async Task SaveImageAsWebpAsync(
        IFormFile file,
        string targetPath,
        CancellationToken cancellationToken,
        int? maxWidth = null,
        int? maxHeight = null,
        bool onlyDownscale = false,
        int? webpQuality = null)
    {
        try
        {
            var originalExt = Path.GetExtension(file.FileName).ToLowerInvariant();
            await using var sourceStream = file.OpenReadStream();

            if (originalExt == ".webp" && maxWidth == null && maxHeight == null)
            {
                await using var targetStream = new FileStream(targetPath, FileMode.CreateNew, FileAccess.Write);
                await sourceStream.CopyToAsync(targetStream, cancellationToken);
                return;
            }

            using var image = await LoadImageForConversionAsync(sourceStream, originalExt, cancellationToken);
            if (maxWidth.HasValue || maxHeight.HasValue)
            {
                // onlyDownscale：只缩不放。头像缩略图需要放大到 96px 的兜底，
                // 但背景小图 / 缩略图若被放大只会变大变糊，因此背景相关调用传 true。
                var needsResize = !onlyDownscale
                    || (maxWidth.HasValue && image.Width > maxWidth.Value)
                    || (maxHeight.HasValue && image.Height > maxHeight.Value);
                if (needsResize)
                {
                    image.Mutate(context => context.Resize(new ResizeOptions
                    {
                        Mode = ResizeMode.Max,
                        Size = new Size(maxWidth ?? image.Width, maxHeight ?? image.Height)
                    }));
                }
            }

            // webpQuality 指定时显式用有损编码（背景图这类照片用有损 85 既清晰又省体积）；
            // 不指定时保持原来的默认编码行为，头像/聊天图片不受影响。
            if (webpQuality.HasValue)
                await image.SaveAsWebpAsync(
                    targetPath,
                    new WebpEncoder { FileFormat = WebpFileFormatType.Lossy, Quality = webpQuality.Value },
                    cancellationToken);
            else
                await image.SaveAsWebpAsync(targetPath, cancellationToken);
        }
        catch (IOException) when (File.Exists(targetPath))
        {
            // 并发上传同一资源时，文件已落盘即可直接复用。
        }
        catch
        {
            try { File.Delete(targetPath); } catch { /* ignore cleanup failures */ }
            throw new InvalidOperationException("图片处理失败");
        }
    }

    /// <summary>
    /// 按真实扩展名选择解码器。HEIC/HEIF 走纯托管解码，其余交给 ImageSharp。
    /// </summary>
    private static async Task<Image> LoadImageForConversionAsync(
        Stream stream,
        string extension,
        CancellationToken cancellationToken)
    {
        if (HeicImageLoader.IsHeicExtension(extension))
            return await HeicImageLoader.LoadAsync(stream, cancellationToken);

        return await Image.LoadAsync(stream, cancellationToken);
    }

    private static (string FilePath, string Extension) GetFilePathWithFallback(
        string directory, string fileKey, string[] allowedExtensions, string defaultExtension)
    {
        // 如果 fileKey 已含扩展名
        if (Path.HasExtension(fileKey))
        {
            var path = Path.Combine(directory, fileKey);
            return (path, Path.GetExtension(fileKey).ToLowerInvariant());
        }

        // 优先尝试默认扩展名
        var primaryPath = Path.Combine(directory, fileKey + defaultExtension);
        if (File.Exists(primaryPath))
            return (primaryPath, defaultExtension);

        // 回退到其他允许的扩展名
        foreach (var ext in allowedExtensions)
        {
            if (string.Equals(ext, defaultExtension, StringComparison.OrdinalIgnoreCase))
                continue;
            var fallbackPath = Path.Combine(directory, fileKey + ext);
            if (File.Exists(fallbackPath))
                return (fallbackPath, ext.ToLowerInvariant());
        }

        return (primaryPath, defaultExtension); // 返回默认路径，由调用方检查存在性
    }

    private static string GetMimeType(string extension) => extension switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".heic" => "image/heic",
        ".heif" or ".hif" => "image/heif",
        _ => SupportedFileTypes.GetValueOrDefault(extension, "application/octet-stream")
    };

    #endregion
}
