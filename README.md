<div>
    <h1 align="center"><code>pdf.js Annotation Extension</code> ⚡️ </h1>
    <p align="center">
        <strong>基于pdf.js viewer的批注扩展，text支持中文字符，支持pdf打印，下载的嵌入</strong>
    </p>
</div>

---

## 1、背景
[PDF.js](https://mozilla.github.io/pdf.js/) 已经提供了 [Viewer](https://mozilla.github.io/pdf.js/web/viewer.html) 用于PDF文件的在线预览，并且提供了一部分的批注功能（FREETEXT、HIGHLIGHT、STAMP、INK）。

在实际使用中，可能会需要各种形式的批注工具，逐产生在viewer上扩展做额外批注的想法。

项目基于konva、react、antd、web-highlighter，使用外部引入的方式，不影响 pdfjs viewer 原有代码，增加并扩展了一部分批注类型，同时解决了中文字符批注不显示问题（转为图片插入），打印，下载批注都能嵌入至pdf文件中，效果见下图：

<div align="center">
  <img src="/examples/demo.gif" alt="demo" />
</div>

对PDF Viewer来说，这是一个很有用的功能，如果需求只是简单的批注，项目中的现有功能已经可以直接满足。
如果有更特殊的需求或功能要求，可以在此基础上进一步开发。

## 2、快速开始

### 初始化
```bash
    $ npm install 或 yarn
```
### 运行开发模式
```bash
    $ npm run dev 或 yarn dev
```
### 查看效果pdfjs viewer 效果
仓库自带了一个 DEMO 示例（在examples文件夹中, 进入 ./examples/pdfjs-4.3.136-dist 目录
```bash
    $ miniserve 或其他静态服务
```
打开地址：http://localhost:8080/web/viewer.html 即可看到效果


## 3、使用方式
### 修改生成文件地址
   配置在文件：/configuration/environment.js 中
   默认为 examples/pdfjs-4.3.136-dist/web/pdfjs-annotation-extension
   您可将它修改为您pdfjs dist地址，以方便开发 

```bash
    output: path.resolve(__dirname, '../examples/pdfjs-4.3.136-dist/web/pdfjs-annotation-extension'),
```
### 打包
```bash
    $ npm run build 或 yarn build
```
也可以直接下载发布版本

### pdfjs dist 引入扩展
修改文件：pdfjs-dist/web/viewer.html，只需增加一行代码，引入生成的文件即可

```html
    <script src="../build/pdf.mjs" type="module"></script>
    <link rel="stylesheet" href="viewer.css">
    <script src="viewer.mjs" type="module"></script>
    <!--这里引入生成的文件-->
    <script src="./pdfjs-annotation-extension/pdfjs-annotation-extension.js" type="module"></script>
    <!--这里引入生成的文件-->
  </head>
```
## 4、工作原理
利用pdfjs EventBus捕获页面事件，动态插入Konva绘图层，在Konva上绘制图形，并将图形数据转换为 pdfjs annotationStorage对应格式数据，存储至annotationStorage中。
批注类型虽然看上去多了，但实际支持与pdfjs一致，只是做了一些特殊的转换。
关于 pdfjs 批注类型的说明请看这里 👇
 https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-annotations

 ## 5、兼容性
 目前仅测试 pdfjs-4.3.136-dist， 不支持页面旋转后的绘制