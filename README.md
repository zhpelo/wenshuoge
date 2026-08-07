# 📚 文硕阁 · 中文公版书数字书阁

<div align="center">

**传承中华文化瑰宝 · 免费分享公版经典**

[🌐 在线访问](https://www.wenshuoge.com/) · [🔎 检索藏书](https://www.wenshuoge.com/#library) · [📖 电子书目录](#电子书列表)

</div>

---

## 🖼️ 网站预览

[![文硕阁网站预览](docs/images/wenshuoge-preview.jpg)](https://www.wenshuoge.com/)

> 正式站点已部署至 Cloudflare：**[www.wenshuoge.com](https://www.wenshuoge.com/)**

## 📖 关于文硕阁

大家好！我是文硕阁的创建者，一个热爱中华传统文化的公版书爱好者。

文硕阁致力于收集、整理和分享已经进入公共版权领域的中文经典著作，让这些文化瑰宝能够被更多人轻松检索、阅读和下载。网站完全公开免费，无需登录注册，不设会员，也没有广告。

## ✨ 网站能力

- 🔎 **即时检索**：支持按书名、作者和主题检索全部藏书
- 📚 **双格式取阅**：提供 EPUB、PDF 两种常用电子书格式
- 🪵 **拟物化设计**：木质书架、实体封面、宣纸与印章视觉效果
- 📱 **响应式布局**：适配桌面电脑、平板和手机
- 🌏 **全球边缘访问**：网站与电子书均由 Cloudflare 网络提供服务
- 🆓 **完全公开免费**：无需登录、无需注册、无会员、无广告

## 🧱 技术架构

网站前端、检索索引和电子书文件均可运行在 Cloudflare 服务中：

| 组件 | 用途 |
|:---|:---|
| **Cloudflare Workers** | 路由、电子书访问接口与安全响应头 |
| **Workers Static Assets** | 托管 HTML、CSS、JavaScript、封面和检索索引 |
| **Cloudflare R2** | 存放 `ebookfiles` 中的 EPUB、PDF 文件 |
| **Wrangler** | 本地开发、类型生成、R2 管理和生产部署 |
| **自动索引脚本** | 从 EPUB 提取书名、作者和主题，生成紧凑书目索引 |

电子书通过 Worker 从 R2 流式返回，并支持 HTTP Range 分段读取，适合在线打开较大的 PDF 文件。公开检索索引经过紧凑化处理，当前约为 **1.32 MB**。

### 项目目录

```text
├── ebookfiles/          # EPUB、PDF 原始电子书
├── public/              # 网站页面、样式、脚本和生成后的书目索引
├── scripts/             # 书目索引与 R2 上传脚本
├── src/                 # Cloudflare Worker 入口
├── docs/images/         # README 网站预览图
└── wrangler.jsonc       # Cloudflare 部署与绑定配置
```

## 🚀 开发与部署

### 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:8787` 即可预览。书目检索可完整使用；本地 R2 未放入文件时，下载入口会提示文件尚未同步。

### 部署到 Cloudflare

首次部署前登录 Cloudflare，检查 R2 存储桶是否存在：

```bash
node node_modules/wrangler/bin/wrangler.js login
node node_modules/wrangler/bin/wrangler.js r2 bucket list
```

如果列表中没有 `wenshuoge`，再创建存储桶：

```bash
node node_modules/wrangler/bin/wrangler.js r2 bucket create wenshuoge
```

上传电子书并发布网站：

```bash
npm run upload:books
npm run deploy
```

`wrangler.jsonc` 已配置自定义域名 `www.wenshuoge.com`。域名需要位于同一个 Cloudflare 账户中；首次部署时 Cloudflare 会创建对应的 Worker 自定义域名记录。

R2 对象使用 `ebookfiles/<编号>/<文件名>` 作为存储键。每次新增电子书后，执行 `npm run index` 即可重建检索索引；`npm run check` 可在发布前完成类型检查与 Cloudflare 部署预检。

## 🎯 我们的使命

文化是一个国家、一个民族的灵魂。我们相信：
- **文化兴国运兴** · 文化强民族强
- **源浚者流长** · 根深者叶茂
- **传承文明硕果** · 保护文化遗产

## 🌟 项目特色

- ✅ **完全免费** - 无需登录注册，无需下载APP
- ✅ **格式丰富** - 提供EPUB、PDF等多种电子书格式
- ✅ **纯净阅读** - 专注于内容，不含广告和商业推广
- ✅ **自由分享** - 支持下载和二次分享，传承互联网分享精神
- ✅ **持续更新** - 每天都在整理更多经典著作

---

## 📊 整理成果统计

| 📚 总藏书量 | 📖 整理章节 | 📝 总字数 | 🔄 更新状态 |
|:---:|:---:|:---:|:---:|
| **12,897本** | **259,450个** | **16.46亿字** | 持续整理中 |

**🕒 每日更新** · **📈 稳步增长** · **🌍 服务全球**

---

## 📚 电子书列表

本仓库包含当前整理的经典公版书籍，每个目录下均提供 **EPUB** 和 **PDF** 两种格式，方便不同设备阅读。

### 📖 国学经典

| 📚 书名 | 📂 目录 | 📄 格式 |
|:---|:---:|:---:|
| **孙子兵法** | [1](ebookfiles/1/) | EPUB · PDF |
| **论语** | [2](ebookfiles/2/) | EPUB · PDF |
| **菜根谭** | [3](ebookfiles/3/) | EPUB · PDF |
| **世说新语** | [4](ebookfiles/4/) | EPUB · PDF |
| **文心雕龙** | [5](ebookfiles/5/) | EPUB · PDF |
| **史记** | [6](ebookfiles/6/) | EPUB · PDF |
| **三十六计** | [7](ebookfiles/7/) | EPUB · PDF |
| **呻吟语** | [8](ebookfiles/8/) | EPUB · PDF |
| **颜氏家训** | [9](ebookfiles/9/) | EPUB · PDF |
| **韩非子** | [10](ebookfiles/10/) | EPUB · PDF |
| **庄子** | [11](ebookfiles/11/) | EPUB · PDF |
| **吕氏春秋** | [12](ebookfiles/12/) | EPUB · PDF |
| **荀子** | [13](ebookfiles/13/) | EPUB · PDF |
| **鬼谷子** | [33](ebookfiles/33/) | EPUB · PDF |
| **增广贤文** | [34](ebookfiles/34/) | EPUB · PDF |
| **三国志** | [35](ebookfiles/35/) | EPUB · PDF |
| **左传** | [36](ebookfiles/36/) | EPUB · PDF |
| **孟子** | [38](ebookfiles/38/) | EPUB · PDF |

### 📖 医学典籍

| 📚 书名 | 📂 目录 | 📄 格式 |
|:---|:---:|:---:|
| **洗冤集录** | [14](ebookfiles/14/) | EPUB · PDF |
| **黄帝内经** | [26](ebookfiles/26/) | EPUB · PDF |
| **本草纲目** | [37](ebookfiles/37/) | EPUB · PDF |

### 📖 文学作品

| 📚 书名 | 📂 目录 | 📄 格式 |
|:---|:---:|:---:|
| **茶馆** | [15](ebookfiles/15/) | EPUB · PDF |
| **我这一辈子** | [16](ebookfiles/16/) | EPUB · PDF |
| **月牙儿** | [17](ebookfiles/17/) | EPUB · PDF |
| **傲慢与偏见** | [18](ebookfiles/18/) | EPUB · PDF |

### 📖 经史子集

| 📚 书名 | 📂 目录 | 📄 格式 |
|:---|:---:|:---:|
| **山海经** | [22](ebookfiles/22/) | EPUB · PDF |
| **周易** | [23](ebookfiles/23/) | EPUB · PDF |
| **资治通鉴** | [25](ebookfiles/25/) | EPUB · PDF |
| **道德经** | [28](ebookfiles/28/) | EPUB · PDF |
| **大学章句集注** | [30](ebookfiles/30/) | EPUB · PDF |
| **中庸** | [31](ebookfiles/31/) | EPUB · PDF |
| **罗织经** | [39](ebookfiles/39/) | EPUB · PDF |
| **声律启蒙** | [40](ebookfiles/40/) | EPUB · PDF |

> 💡 **提示**: 点击目录链接可直接浏览对应电子书文件

---

## ❓ 什么是公版书？

根据我国现行《著作权法》第20、21条的规定，除署名权、修改权、保护作品完整权外，中国公民对其著作的法定权利均于作者死亡后第五十年的12月31日截止。超过著作权法保护日期后，其作品就进入了公有领域（公共版权）。

这种因作者死亡超过50年而丧失发行权、改编权等著作权利的书籍，就称为"公共版权书籍"，简称"公版书"。

## 📋 授权许可

本项目的电子书资源遵循 **合理使用** 原则：

- ✅ **无需获得许可** - 适用于所有用途，包括商业用途
- ✅ **无需支付版税** - 即使商业盈利用途也完全免费
- ✅ **支持自由分享** - 鼓励传播和二次创作

---

## 🤝 加入我们

文化自信是一个国家、一个民族发展中最基本、最深沉、最持久的力量。

我们诚挚邀请更多热爱中华文化的志愿者加入 **[传硕计划](https://www.wenshuoge.com/)**，让我们一起：

- 📚 收集整理更多公版经典
- 🎨 优化电子书排版质量
- 🌐 扩大传播范围和影响力
- 💡 开发更好的阅读体验

### 📮 联系方式

- 🌐 **官方网站**: https://www.wenshuoge.com/
- 📧 **邮箱**: [联系我们](mailto:contact@wenshuoge.com)
- 💬 **微信公众号**: 文硕阁

---

<div align="center">

**源浚者流长 · 根深者叶茂**

**让我们一起守护中华文化传承**

---

*Made with ❤️ for Chinese cultural heritage*

</div>
