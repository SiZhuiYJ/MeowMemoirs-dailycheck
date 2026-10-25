using api.Data;
using api.Hubs;
using api.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SixLabors.ImageSharp;
using StackExchange.Redis;
using System;
using System.IO.Compression;
using System.Text;


// 数据库
//protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
//#warning To protect potentially sensitive information in your connection string, you should move it out of source code. You can avoid scaffolding the connection string by using the Name= syntax to read it from configuration - see https://go.microsoft.com/fwlink/?linkid=2131148. For more guidance on storing connection strings, see https://go.microsoft.com/fwlink/?LinkId=723263.

#region 远程
//    => optionsBuilder.UseMySql("server=<REMOTE_HOST>;database=dailycheck;charset=utf8;uid=<USER>;pwd=<PASSWORD>;port=3306", Microsoft.EntityFrameworkCore.ServerVersion.Parse("8.0.36-mysql"));
// scaffold-dbcontext 'server=<REMOTE_HOST>;database=dailycheck;charset=utf8;uid=<USER>;pwd=<PASSWORD>;port=3306;' Pomelo.EntityFrameworkCore.MySql -OutputDir Data -context DailyCheckDbContext -Force
#endregion

#region 本地
// server=127.0.0.1;database=dailycheck;charset=utf8;uid=root;pwd=<PASSWORD>;port=3306
// scaffold-dbcontext 'server=127.0.0.1;database=dailycheck;charset=utf8;uid=root;pwd=<PASSWORD>;port=3306;' Pomelo.EntityFrameworkCore.MySql -OutputDir Data -context DailyCheckDbContext -Force
#endregion
var builder = WebApplication.CreateBuilder(args);

#region 跨域配置
var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ??
    (builder.Environment.IsDevelopment()
        ? ["http://localhost:5173", "http://127.0.0.1:5173"]
        : Array.Empty<string>());

builder.Services.AddCors(options =>
{
    options.AddPolicy("MyCors", policy =>
    {
        policy.AllowAnyHeader()
              .AllowAnyMethod();

        if (corsOrigins.Length > 0)
        {
            policy.WithOrigins(corsOrigins)
                  .AllowCredentials();
        }
    });
});
#endregion

//则是自动初始化AppSettings实例并且映射appSettings里的配置
//builder.Services.Configure<AppSettingModel>(Configuration.GetSection("Appsettings"));

builder.Services.AddControllers();
builder.Services.AddRouting(options =>
{
    options.ConstraintMap["ulong"] = typeof(ULongRouteConstraint);
});

#region 响应压缩
// 聊天 / 收件箱 / 日历这些接口返回的是大段 JSON，压缩后通常只剩 15%~30%。
// 用 Brotli 优先、Gzip 兜底，压缩级别取 Fastest：CPU 开销低，收益已经足够。
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(new[]
    {
        "application/json",
        "application/problem+json",
        "application/manifest+json",
        "image/svg+xml",
        "text/markdown"
    });
});
builder.Services.Configure<BrotliCompressionProviderOptions>(options =>
    options.Level = CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(options =>
    options.Level = CompressionLevel.Fastest);
#endregion
builder.Services.AddEndpointsApiExplorer();

#region Swagger配置
builder.Services.AddSwaggerGen(opt =>
{
    #region 配置接口注释

    string xmlPath = Path.Combine(AppContext.BaseDirectory, "api.xml");// xml 名称一般和项目名称一致即可
    opt.IncludeXmlComments(xmlPath);

    #endregion

    #region 配置接口分组或版本

    opt.SwaggerDoc("v1", new OpenApiInfo
    {
        Version = "v1",
        Title = "DailyCheck API v1",
        Description = "DailyCheck API v1",
    });

    #endregion

    #region 配置接口token验证
    opt.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme()
    {
        Description = "在下框中输入请求头中需要添加Jwt授权Token：Bearer Token",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey,
        BearerFormat = "JWT",
        Scheme = "Bearer"
    });

    opt.AddSecurityRequirement(new OpenApiSecurityRequirement
                    {
                        {
                            new OpenApiSecurityScheme{
                                Reference = new OpenApiReference {
                                            Type = ReferenceType.SecurityScheme,
                                            Id = "Bearer"
                                }
                           },Array.Empty<string>()
                        }
    });
    #endregion
});
#endregion

#region jwt配置
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.Configure<WechatOptions>(builder.Configuration.GetSection("Wechat"));
builder.Services.AddHttpClient<IWechatAuthService, WechatAuthService>(client =>
{
    client.BaseAddress = new Uri("https://api.weixin.qq.com/");
    client.Timeout = TimeSpan.FromSeconds(10);
});
#endregion

#region 缓存与验证码服务配置
builder.Services.AddMemoryCache();
builder.Services.AddScoped<IEmailService, EmailService>();
builder.Services.AddScoped<IVerificationCodeService, VerificationCodeService>();

builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
{
    var configuration = sp.GetRequiredService<IConfiguration>();
    var redisSection = configuration.GetSection("Redis");
    var enabled = redisSection.GetValue<bool?>("Enabled") ?? false;
    if (!enabled)
        return null!;

    var connectionString = redisSection.GetValue<string>("Configuration");
    if (string.IsNullOrWhiteSpace(connectionString))
        throw new InvalidOperationException("Redis:Configuration is required when Redis:Enabled is true");

    return ConnectionMultiplexer.Connect(connectionString);
});
#endregion

#region 文件服务配置
builder.Services.AddScoped<IFileService, LocalFileService>();
#endregion

#region 数据库上下文注册
var connectionString = builder.Configuration.GetConnectionString("Default");
// 生产环境可以写死 "Database:ServerVersion"（例如 8.0.36-mysql / 10.4.0-mariadb），
// 这样启动时不用先连一次数据库去探测版本；没配置时仍然自动探测，保持旧行为。
var configuredServerVersion = builder.Configuration["Database:ServerVersion"];
builder.Services.AddDbContextPool<DailyCheckDbContext>(options =>
{
    if (string.IsNullOrWhiteSpace(connectionString))
        throw new InvalidOperationException("ConnectionStrings:Default is not configured");

    var serverVersion = string.IsNullOrWhiteSpace(configuredServerVersion)
        ? ServerVersion.AutoDetect(connectionString)
        : ServerVersion.Parse(configuredServerVersion);

    options.UseMySql(connectionString, serverVersion);
}, poolSize: 32);
#endregion

#region AutoMapper配置
var jwtSection = builder.Configuration.GetSection("Jwt");
var jwtKey = jwtSection.GetValue<string>("Key") ?? string.Empty;
var jwtIssuer = jwtSection.GetValue<string>("Issuer") ?? string.Empty;
var jwtAudience = jwtSection.GetValue<string>("Audience") ?? string.Empty;

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
}).AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtIssuer,
        ValidAudience = jwtAudience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
    };
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            var accessToken = context.Request.Query["access_token"];
            var path = context.HttpContext.Request.Path;

            if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs/chat"))
                context.Token = accessToken;

            return Task.CompletedTask;
        }
    };
});
#endregion

builder.Services.AddAuthorization();
builder.Services.AddSignalR(options =>
{
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(45);
    options.HandshakeTimeout = TimeSpan.FromSeconds(15);
});

var app = builder.Build();

// 压缩中间件要在所有可能写响应体的中间件之前。
app.UseResponseCompression();

#region 配置CORS
app.UseCors("MyCors");
#endregion

app.UseMiddleware<GlobalExceptionMiddleware>();
app.UseMiddleware<RedisTokenValidationMiddleware>();

#region 配置HTTP请求管道
if (app.Environment.IsDevelopment())
{
    #region 配置Swagger
    app.UseSwagger();
    app.UseSwaggerUI(opt =>
    {
        opt.SwaggerEndpoint("/swagger/v1/swagger.json", "DailyCheck API v1");
    });
    #endregion
}
#endregion

#region 静态文件配置
var webRootPath = app.Environment.WebRootPath;
if (string.IsNullOrWhiteSpace(webRootPath))
{
    webRootPath = Path.Combine(app.Environment.ContentRootPath, "wwwroot");
}

Directory.CreateDirectory(webRootPath);


app.UseStaticFiles();
#endregion

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");

app.Run();
