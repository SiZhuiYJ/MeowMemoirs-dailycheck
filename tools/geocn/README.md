# tools/geocn — 国内登录记录 IP 归属地数据

登录记录页（`uni-app/src/pages/settings/login-records.vue`）需要把每条登录 IP
解析成国内省市（如「河南 · 郑州」）。这里放的是解析所需的离线数据与更新脚本，
原始工具来自 `~/tools/ipTo/GeoCN-main.zip`（项目地址见下）。

## 数据来源

- 项目：<https://github.com/ljxi/GeoCN>
- 数据：GeoCN 只收录 MaxMind 判定为**中国大陆**的 IPv4/IPv6 段，
  所以「在库里查不到」就等价于「境外（或私有地址）」，不需要额外引入 GeoLite2-City。
- 区域编码表（`full.txt` / `short.txt`）来自仓库 `data/`，
  `GeoCN.mmdb` 的 `division_code` 字段按国家统计局行政区划编码（6 位）解释：
  省 = 编码 / 10000 * 10000，市 = 编码 / 100 * 100，区 = 编码本身。

## 文件

| 文件 | 是否入库 | 说明 |
| --- | --- | --- |
| `fetch-geocn.sh` | 是 | 拉取 / 校验数据 |
| `api/Resources/ipTo/full.txt` | 是 | 省市区**全名**（`编码\t名称`，约 65KB） |
| `api/Resources/ipTo/short.txt` | 是 | 省市区**简称**（`编码  名称`，双空格分隔，约 56KB） |
| `api/Resources/ipTo/GeoCN.mmdb` | 否（`.gitignore`） | 8.7MB 二进制库，用脚本拉取 |

## 用法

```bash
bash tools/geocn/fetch-geocn.sh          # 拉取最新数据（会覆盖）
bash tools/geocn/fetch-geocn.sh --check  # 只校验本地文件是否就绪
```

拉取后重启后端生效（Development：`bash ~/notebook-devstack.sh restart dev`）。

## 运行时行为

- 服务启动时以单例加载 mmdb 与两张映射表，查询只走内存（MaxMind.Db 的 `Reader` 线程安全）。
- 查询流程：`ip → division_code → 省/市/区简称`；命中即 `is_domestic = 1`，
  未命中则按「私有/回环地址 → 本地网络」「其它 → 境外」处理。
- **数据缺失不会阻断登录**：mmdb 不存在时后端只打印一条 warning，
  登录仍照常记录（地点显示「未知位置」），页面其它功能不受影响。
- 数据更新周期跟随上游 release（随缘更新），如需最新数据重新跑脚本即可。
