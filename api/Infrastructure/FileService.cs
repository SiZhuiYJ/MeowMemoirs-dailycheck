using api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
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
    private const long MaxChatFileBytes = 100 * 1024 * 1024;      // 100 MB
    private const int AvatarThumbnailMaxPixels = 96;
    private const string AvatarThumbnailSuffix = "_thumb";

    private static readonly string[] AllowedImageExtensions =
    [
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"
    ];

    private static readonly Dictionary<string, string> SupportedFileTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        // 图片
        { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".png", "image/png" },
        { ".gif", "image/gif" }, { ".webp", "image/webp" }, { ".bmp", "image/bmp" },
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
        string fileKey, storedExtension, contentType;
        long fileSize;
        // 判断是否已存在fileKey 
        if (await _db.ChatFileRecords.AnyAsync(x => x.ConversationId == conversationId && x.FileKey == file.FileName, cancellationToken))
        {
            throw new InvalidOperationException("文件已存在");
        }

        if (isImage)
        {
            // 图片统一存储为 .webp，fileKey 不带扩展名
            var (_, keyWithoutExt) = await ComputeHashAndSaveWebpAsync(file, root, cancellationToken);
            fileKey = keyWithoutExt;
            storedExtension = ".webp";
            contentType = "image/webp";
            fileSize = new FileInfo(Path.Combine(root, fileKey + storedExtension)).Length;
        }
        else
        {
            // 非图片保留原始扩展名，fileKey 带扩展名
            var (_, keyWithoutExt) = await ComputeHashAsync(file.OpenReadStream(), cancellationToken);
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            fileKey = $"{keyWithoutExt}_{timestamp:x}{originalExtension}";
            storedExtension = originalExtension;
            contentType = SupportedFileTypes[originalExtension];

            var filePath = Path.Combine(root, fileKey);
            await using var stream = file.OpenReadStream();
            await using var fileStream = new FileStream(filePath, FileMode.CreateNew, FileAccess.Write);
            await stream.CopyToAsync(fileStream, cancellationToken);
            fileSize = fileStream.Length;
        }

        // 插入元数据记录
        var record = new ChatFileRecord
        {
            FileKey = fileKey,
            ConversationId = conversationId,
            UploaderUserId = userId,
            FileSize = (ulong)fileSize,
            ContentType = contentType,
            IsDeleted = false,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.ChatFileRecords.Add(record);
        await _db.SaveChangesAsync(cancellationToken);

        return new FileInfoResult
        {
            FileKey = fileKey,
            OriginalFileName = Path.GetFileNameWithoutExtension(file.FileName),
            FileSize = fileSize,
            ContentType = contentType
        };
    }

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

    private static void ValidateImageFile(IFormFile file)
    {
        if (file == null || file.Length == 0)
            throw new InvalidOperationException("文件不能为空");
        if (file.Length > MaxImageBytes)
            throw new InvalidOperationException($"图片大小超过限制（最大 {MaxImageBytes / 1024 / 1024} MB）");

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!AllowedImageExtensions.Contains(ext))
            throw new InvalidOperationException("仅支持常见图片格式");
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

        // 文件已存在则直接返回
        if (File.Exists(webpPath))
            return (hash, fileKey);

        // 不存在则转换并保存
        try
        {
            var originalExt = Path.GetExtension(file.FileName).ToLowerInvariant();
            await using var sourceStream = file.OpenReadStream();

            if (originalExt == ".webp")
            {
                await using var fileStream = new FileStream(webpPath, FileMode.CreateNew, FileAccess.Write);
                await sourceStream.CopyToAsync(fileStream, cancellationToken);
            }
            else
            {
                using var image = await Image.LoadAsync(sourceStream, cancellationToken);
                await image.SaveAsWebpAsync(webpPath, cancellationToken);
            }
        }
        catch (IOException) when (File.Exists(webpPath))
        {
            // 并发写入时，另一个请求已经创建了文件，忽略异常
        }
        catch
        {
            try { File.Delete(webpPath); } catch { /* 忽略删除失败 */ }
            throw new InvalidOperationException("图片处理失败");
        }

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
        int? maxHeight = null)
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

            using var image = await Image.LoadAsync(sourceStream, cancellationToken);
            if (maxWidth.HasValue || maxHeight.HasValue)
            {
                image.Mutate(context => context.Resize(new ResizeOptions
                {
                    Mode = ResizeMode.Max,
                    Size = new Size(maxWidth ?? image.Width, maxHeight ?? image.Height)
                }));
            }

            await image.SaveAsWebpAsync(targetPath, cancellationToken);
        }
        catch (IOException) when (File.Exists(targetPath))
        {
            // 并发上传同一资源时，文件已落盘即可直接复用。
        }
        catch
        {
            try { File.Delete(targetPath); } catch { /* ignore cleanup failures */ }
            throw new InvalidOperationException("鍥剧墖澶勭悊澶辫触");
        }
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
        _ => SupportedFileTypes.GetValueOrDefault(extension, "application/octet-stream")
    };

    #endregion
}
