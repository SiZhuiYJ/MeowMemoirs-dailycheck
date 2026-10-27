using Heic.Net;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace api.Infrastructure;

/// <summary>
/// HEIC/HEIF 解码入口。
///
/// iPhone 从 iOS 11 起默认把相册照片存成 HEIC（HEVC 编码的 HEIF 容器），
/// 浏览器（Chrome/Firefox/大部分 Android WebView）和 ImageSharp 都不能直接解码。
/// 这里使用纯托管的 Heic.NET，把主图解成 RGBA8，再交给 ImageSharp 统一缩略/转 WebP。
///
/// 为什么不依赖 libheif / ImageMagick：
/// 本项目会跑在 Android/Termux、Linux 服务器等多种环境，带 glibc 的原生 so
/// 在 Termux（bionic）上根本加载不了；纯托管实现没有部署侧的原生依赖。
/// </summary>
internal static class HeicImageLoader
{
    /// <summary>允许的扩展名（大小写不敏感）。</summary>
    private static readonly HashSet<string> HeicExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".heic", ".heif", ".hif"
    };

    /// <summary>
    /// 解码资源上限。
    ///
    /// 上传入口本身限制 10MB，但 HEIC 容器允许内嵌多张图，这里仍然显式限制
    /// 输入字节、像素数和 item 数，避免恶意文件把服务端内存打满。
    /// 50MP 足够覆盖 iPhone 的 48MP 照片，再大就明确拒绝。
    /// </summary>
    private const int MaxInputBytes = 32 * 1024 * 1024;
    private const int MaxPixels = 50_000_000;
    private const int MaxItems = 512;
    private const int MaxDerivationDepth = 8;

    private static readonly HeicDecodeOptions DecodeOptions = new(
        maxInputBytes: MaxInputBytes,
        maxPixels: MaxPixels,
        maxItems: MaxItems,
        maxDerivationDepth: MaxDerivationDepth);

    public static bool IsHeicExtension(string? extension) =>
        !string.IsNullOrWhiteSpace(extension) && HeicExtensions.Contains(extension);

    public static bool IsHeicFileName(string? fileName) =>
        IsHeicExtension(Path.GetExtension(fileName));

    public static async Task<Image<Rgba32>> LoadAsync(Stream stream, CancellationToken cancellationToken)
    {
        var document = await HeicDocument.LoadAsync(stream, DecodeOptions, cancellationToken);

        // DecodePrimary 是纯 CPU 工作：放到线程池，避免占住请求线程。
        var decoded = await Task.Run(document.DecodePrimary, cancellationToken);

        return Image.LoadPixelData<Rgba32>(
            decoded.Pixels.Span,
            decoded.Width,
            decoded.Height);
    }
}
