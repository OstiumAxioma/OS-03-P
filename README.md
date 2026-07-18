# ThreeVTK

ThreeVTK 是一个基于 Next.js、Three.js、vtk.js 与 ITK-Wasm 的医学组织切片可视化项目。浏览器只负责上传和 GPU 三维渲染；DICOM / NIfTI 解码、序列选择、组织着色和纹理生成均在 Node.js 服务器进程中完成。

## 本地运行

环境要求：

- Windows 10 / 11
- Node.js 20.9 或更高版本
- npm 10 或兼容版本

首次运行：

```powershell
Set-Location D:\Project\ThreeVTK
npm ci
npm run dev
```

然后访问 `http://localhost:3000`。前端使用 Three.js `WebGPURenderer` 与 `MeshSSSNodeMaterial`；支持 WebGPU 时直接使用 WebGPU，否则由 Three.js 回退到 WebGL2。不会禁用 GPU，也不需要在用户电脑安装 ITK、VTK 或 Python。

生产模式本地验证：

```powershell
npm run build
npm start
```

测试：

```powershell
npm test
```

## 支持的上传格式

- DICOM：选择多个 DICOM 文件，或上传一个包含 DICOM 文件的 ZIP。
- NIfTI：上传一个 `.nii` 或 `.nii.gz` 文件。
- DICOM 存在多个序列时，服务器按 `SeriesInstanceUID` 分组，并自动选择文件数最多的序列。
- 服务器最多返回 7 层切片纹理，单张纹理最长边不超过 512 像素。

## 组织颜色与 SSS 渲染

- 每张切片是一个无圆角、封闭的薄 `BoxGeometry`，不使用内部黑底 Plane。
- CT 数据按连续 HU 传递函数为肺、脂肪、软组织、致密组织和骨骼着色；空气区域写入 `alpha = 0`。
- 非 CT NIfTI 没有可靠 HU 语义，使用数据范围归一化调色，并在界面标记为 `NORMALIZED`。
- 服务器为每层生成 RGBA 组织颜色、roughness 和 SSS thickness 三张纹理。
- 正反面使用 `MeshSSSNodeMaterial`，侧面使用物理透射材质；`RoomEnvironment + PMREM` 提供环境光照。
- 场景采用 Z-up：X 为左右，Y 为切片层深，Z 为上下和切片抽出方向。

HU 颜色映射仅用于可视化效果，不是医学诊断分割、组织识别或定量分析结果。

默认上传上限为 1 GB。可在启动前通过环境变量调整，例如：

```powershell
$env:THREEVTK_MAX_UPLOAD_MB = "2048"
npm run dev
```

## 上传 API

`POST /api/studies` 接收 `multipart/form-data`：

- `kind`: `dicom` 或 `nifti`
- `files`: 一个或多个文件

成功响应包含研究尺寸、间距、模态、`intensityMapping`（`hu` 或 `normalized`）、总切片数，以及最多 7 组 Base64 diffuse / roughness / thickness 纹理。DICOM 响应不会包含患者姓名、患者 ID 等身份字段。

错误响应统一为：

```json
{
  "code": "ERROR_CODE",
  "message": "Readable error message"
}
```

状态码约定：请求或格式错误为 `400`，超过大小限制为 `413`，影像无法解析为 `422`，未预期的服务器异常为 `500`。

## 临时文件与隐私

上传内容写入操作系统临时目录，仅用于当前请求。无论解析成功或失败，临时目录都会在 `finally` 清理。应用不会持久化原始影像，不会记录上传文件名或患者医学元数据。

## 未来云端部署说明

当前仓库没有执行任何云端部署。部署平台需满足：

- 支持长期运行的 Node.js 20.9+ 进程或 Docker 容器，不能使用仅支持 Edge Runtime 的环境。
- 提供可写的临时磁盘，并允许 ITK-Wasm Node 模块及其 WebAssembly 资源运行。
- 反向代理、负载均衡器和平台本身均需放宽请求体上限；至少要与 `THREEVTK_MAX_UPLOAD_MB` 保持一致。
- 请求超时应按医学影像体积配置，建议允许至少 5 分钟。
- 生产环境必须使用 HTTPS，并在公网开放前补充身份认证、访问控制、审计和限流。
- 如需多实例扩展，可保持当前无状态设计；原始影像不写入共享存储。如未来需要持久化，应另行引入对象存储、任务队列与数据保留策略。

`next.config.mjs` 已启用 `output: "standalone"`。`npm start` 的 `prestart` 步骤会把 `.next/static` 和 `public`（如果后续增加该目录）复制到 standalone 运行目录。容器化时执行一次 `npm start` 前的准备步骤，或在镜像构建中完成同样的复制，并保证 ITK-Wasm 运行时依赖随 standalone 输出一同存在。
