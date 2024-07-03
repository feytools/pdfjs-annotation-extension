import './index.scss' // 导入画笔样式文件
import Konva from 'konva'
import { EventBus, PageViewport, PDFPageView, PDFViewerApplication } from 'pdfjs'
import { AnnotationType, IAnnotationContent, IAnnotationType, IPdfjsAnnotationStorage } from '../const/definitions'
import { WebSelection } from './webSelection'
import { Editor, IShapeGroup } from './editor/editor'
import { EditorRectangle } from './editor/editor_rectangle'
import { Store } from './store'
import { isElementInDOM, removeCssCustomProperty } from '../utils/utils'
import { EditorHighLight } from './editor/editor_highlight'
import { EditorEllipse } from './editor/editor_ellipse'
import { EditorFreeHand } from './editor/editor_free_hand'
import { EditorFreeHighlight } from './editor/editor_free_highlight'
import { EditorSignature } from './editor/editor_signature'
import { EditorStamp } from './editor/editor_stamp'
import { Selector } from './editor/selector'
import { CURSOR_CSS_PROPERTY, PAINTER_IS_PAINTING_STYLE, PAINTER_PAINTING_TYPE, PAINTER_WRAPPER_PREFIX } from './const'
import { EditorFreeText } from './editor/editor_free_text'

// KonvaCanvas 接口定义
export interface KonvaCanvas {
    pageNumber: number
    konvaStage: Konva.Stage
    wrapper: HTMLDivElement
    isActive: boolean
}

// Painter 类定义
export class Painter {
    private konvaCanvasStore: Map<number, KonvaCanvas> = new Map() // 存储 KonvaCanvas 实例
    private editorStore: Map<string, Editor> = new Map() // 存储编辑器实例
    private pdfViewerApplication: PDFViewerApplication // PDFViewerApplication 实例
    private pdfjsEventBus: EventBus // PDF.js EventBus 实例
    private webSelection: WebSelection // WebSelection 实例
    private currentAnnotation: IAnnotationType | null = null // 当前批注类型
    private store: Store // 存储实例
    private selector: Selector // 选择器实例
    private tempDataTransfer: string | null // 临时数据传输
    public readonly setDefaultMode: () => void // 设置默认模式的函数引用

    /**
     * 构造函数，初始化 PDFViewerApplication, EventBus, 和 WebSelection
     * @param params - 包含 PDFViewerApplication 和 EventBus 的对象
     */
    constructor({
        PDFViewerApplication,
        PDFJS_EventBus,
        setDefaultMode
    }: {
        PDFViewerApplication: PDFViewerApplication
        PDFJS_EventBus: EventBus
        setDefaultMode: () => void
    }) {
        this.pdfViewerApplication = PDFViewerApplication // 初始化 PDFViewerApplication
        this.pdfjsEventBus = PDFJS_EventBus // 初始化 PDF.js EventBus
        this.setDefaultMode = setDefaultMode // 设置默认模式的函数
        this.store = new Store({ PDFViewerApplication }) // 初始化存储实例
        this.selector = new Selector({
            // 初始化选择器实例
            konvaCanvasStore: this.konvaCanvasStore,
            getAnnotationStore: (id: string) => {
                return this.store.annotation(id)
            },
            onChange: async (id, groupString, rawAnnotationStore) => {
                const editor = this.findEditorForGroupId(id)
                if (editor) {
                    this.store.update(id, {
                        konvaString: groupString,
                        pdfjsAnnotationStorage: await editor.refreshPdfjsAnnotationStorage(id, groupString, rawAnnotationStore)
                    })
                }
            },
            onDelete: id => {
                this.deleteAnnotation(id)
            }
        })
        this.webSelection = new WebSelection({
            // 初始化 WebSelection 实例
            onSelect: (pageNumber, elements) => {
                const canvas = this.konvaCanvasStore.get(pageNumber)
                if (canvas) {
                    const { konvaStage, wrapper } = canvas
                    const editor = new EditorHighLight(
                        {
                            konvaStage,
                            pageNumber,
                            annotation: this.currentAnnotation,
                            onAdd: (shapeGroup, pdfjsAnnotationStorage, annotationContent) => {
                                this.saveToStore(shapeGroup, pdfjsAnnotationStorage, annotationContent)
                            }
                        },
                        this.currentAnnotation.type
                    )
                    this.editorStore.set(editor.id, editor)
                    editor.convertTextSelection(elements, wrapper)
                }
            }
        })
        this.bindGlobalEvents() // 绑定全局事件
    }

    /**
     * 绑定全局事件。
     */
    private bindGlobalEvents(): void {
        window.addEventListener('keyup', this.globalKeyUpHandler) // 监听全局键盘事件
    }

    /**
     * 全局键盘抬起事件处理器。
     * @param e - 键盘事件。
     */
    private globalKeyUpHandler = (e: KeyboardEvent): void => {
        if (e.code === 'Escape' && (this.currentAnnotation.type === AnnotationType.SIGNATURE || this.currentAnnotation.type === AnnotationType.STAMP)) {
            removeCssCustomProperty(CURSOR_CSS_PROPERTY) // 移除自定义 CSS 属性
            this.setDefaultMode() // 设置默认模式
        }
    }

    /**
     * 创建绘图容器 (painterWrapper)
     * @param pageView - 当前 PDF 页面视图
     * @param pageNumber - 当前页码
     * @returns 绘图容器元素
     */
    private createPainterWrapper(pageView: PDFPageView, pageNumber: number): HTMLDivElement {
        const wrapper = document.createElement('div') // 创建 div 元素作为绘图容器
        wrapper.id = `${PAINTER_WRAPPER_PREFIX}_page_${pageNumber}` // 设置 id
        wrapper.setAttribute('data-main-rotation', `${pageView.viewport.rotation}`) // 设置视口旋转角度
        wrapper.classList.add(PAINTER_WRAPPER_PREFIX) // 添加类名

        const { width, height } = {
            width: pageView.viewport.viewBox[2],
            height: pageView.viewport.viewBox[3]
        } // 获取视口宽度和高度
        const scaleFactor = 'var(--scale-factor)' // 获取缩放因子
        wrapper.style.width = `calc(${scaleFactor} * ${width}px)` // 设置宽度样式
        wrapper.style.height = `calc(${scaleFactor} * ${height}px)` // 设置高度样式

        pageView.div.appendChild(wrapper)

        return wrapper
    }

    /**
     * 创建 Konva Stage
     * @param container - 绘图容器元素
     * @param viewport - 当前 PDF 页面视口
     * @returns Konva Stage
     */
    private createKonvaStage(container: HTMLDivElement, viewport: PageViewport): Konva.Stage {
        const stage = new Konva.Stage({
            container,
            width: viewport.width,
            height: viewport.height,
            rotation: viewport.rotation,
            scale: {
                x: viewport.scale,
                y: viewport.scale
            }
        })

        const backgroundLayer = new Konva.Layer()
        stage.add(backgroundLayer)

        return stage
    }

    /**
     * 清理无效的 canvasStore
     */
    private cleanUpInvalidStore(): void {
        this.konvaCanvasStore.forEach(konvaCanvas => {
            if (!isElementInDOM(konvaCanvas.wrapper)) {
                konvaCanvas.konvaStage.destroy()
                this.konvaCanvasStore.delete(konvaCanvas.pageNumber)
            }
        })
    }

    /**
     * 插入新的绘图容器和 Konva Stage
     * @param pageView - 当前 PDF 页面视图
     * @param pageNumber - 当前页码
     */
    private insertCanvas(pageView: PDFPageView, pageNumber: number): void {
        this.cleanUpInvalidStore()
        const painterWrapper = this.createPainterWrapper(pageView, pageNumber)
        const konvaStage = this.createKonvaStage(painterWrapper, pageView.viewport)

        this.konvaCanvasStore.set(pageNumber, {
            pageNumber,
            konvaStage,
            wrapper: painterWrapper,
            isActive: false
        })
        this.reDrawAnnotation(pageNumber) // 重绘批注
        this.enablePainting() // 启用绘画
    }

    /**
     * 调整现有 KonvaCanvas 的缩放
     * @param pageView - 当前 PDF 页面视图
     * @param pageNumber - 当前页码
     */
    private scaleCanvas(pageView: PDFPageView, pageNumber: number): void {
        const konvaCanvas = this.konvaCanvasStore.get(pageNumber)
        if (!konvaCanvas) return

        const { konvaStage } = konvaCanvas
        const { scale, width, height } = pageView.viewport

        konvaStage.scale({ x: scale, y: scale })
        konvaStage.width(width)
        konvaStage.height(height)
    }

    /**
     * 设置当前模式 (选择模式、绘画模式、默认模式)
     * @param mode - 模式类型 ('selection', 'painting', 'default')
     */
    private setMode(mode: 'selection' | 'painting' | 'default'): void {
        const isPainting = mode === 'painting' // 是否绘画模式
        const isSelection = mode === 'selection' // 是否选择模式
        this.webSelection[isSelection ? 'enable' : 'disable']() // 启用或禁用 WebSelection
        document.body.classList.toggle(`${PAINTER_IS_PAINTING_STYLE}`, isPainting) // 添加或移除绘画模式样式
        const allAnnotationClasses = Object.values(AnnotationType)
            .filter(type => typeof type === 'number')
            .map(type => `${PAINTER_PAINTING_TYPE}_${type}`)
        // 移除所有可能存在的批注类型样式
        allAnnotationClasses.forEach(cls => document.body.classList.remove(cls))
        // 移出签名鼠标指针变量
        removeCssCustomProperty(CURSOR_CSS_PROPERTY)

        if (this.currentAnnotation) {
            document.body.classList.add(`${PAINTER_PAINTING_TYPE}_${this.currentAnnotation?.type}`)
        }
    }

    /**
     * 保存到存储
     * @param shapeGroup - 形状组
     * @param pdfjsAnnotationStorage - PDF.js 批注存储
     * @param annotationContent - 批注内容
     */
    private saveToStore(shapeGroup: IShapeGroup, pdfjsAnnotationStorage: IPdfjsAnnotationStorage, annotationContent?: IAnnotationContent) {
        this.store.save(shapeGroup, pdfjsAnnotationStorage, annotationContent)
    }

    /**
     * 根据组 ID 查找编辑器
     * @param groupId - 组 ID
     * @returns 编辑器实例
     */
    private findEditorForGroupId(groupId: string): Editor {
        let editor: Editor = null
        this.editorStore.forEach(_editor => {
            if (_editor.shapeGroupStore?.has(groupId)) {
                editor = _editor
                return
            }
        })
        return editor
    }

    /**
     * 根据页码和编辑器类型查找编辑器
     * @param pageNumber - 页码
     * @param editorType - 编辑器类型
     * @returns 编辑器实例
     */
    private findEditor(pageNumber: number, editorType: AnnotationType): Editor {
        return this.editorStore.get(`${pageNumber}_${editorType}`)
    }

    /**
     * 启用特定类型的编辑器
     * @param options - 包含 Konva Stage、页码和批注类型的对象
     */
    private enableEditor({ konvaStage, pageNumber, annotation }: { konvaStage: Konva.Stage; pageNumber: number; annotation: IAnnotationType }): void {
        const storeEditor = this.findEditor(pageNumber, annotation.type) // 查找存储中的编辑器实例
        if (storeEditor) {
            if (storeEditor instanceof EditorSignature) {
                storeEditor.activateWithSignature(konvaStage, annotation, this.tempDataTransfer) // 激活带有签名的编辑器
                return
            }
            if (storeEditor instanceof EditorStamp) {
                storeEditor.activateWithStamp(konvaStage, annotation, this.tempDataTransfer) // 激活带有图章的编辑器
                return
            }
            storeEditor.activate(konvaStage, annotation) // 激活编辑器
            return
        }
        let editor: Editor | null = null // 初始化编辑器为空
        switch (annotation.type) {
            case AnnotationType.FREETEXT:
                editor = new EditorFreeText({
                    konvaStage,
                    pageNumber,
                    annotation,
                    onAdd: (shapeGroup, pdfjsAnnotationStorage, annotationContent) => {
                        this.saveToStore(shapeGroup, pdfjsAnnotationStorage, annotationContent)
                    }
                })
                break
            case AnnotationType.RECTANGLE:
                editor = new EditorRectangle({
                    konvaStage,
                    pageNumber,
                    annotation,
                    onAdd: (shapeGroup, pdfjsAnnotationStorage) => {
                        this.saveToStore(shapeGroup, pdfjsAnnotationStorage)
                    }
                })
                break

            case AnnotationType.ELLIPSE:
                editor = new EditorEllipse({
                    konvaStage,
                    pageNumber,
                    annotation,
                    onAdd: (shapeGroup, pdfjsAnnotationStorage) => {
                        this.saveToStore(shapeGroup, pdfjsAnnotationStorage)
                    }
                })
                break
            case AnnotationType.FREEHAND:
                editor = new EditorFreeHand({
                    konvaStage,
                    pageNumber,
                    annotation,
                    onAdd: (shapeGroup, pdfjsAnnotationStorage) => {
                        this.saveToStore(shapeGroup, pdfjsAnnotationStorage)
                    }
                })
                break
            case AnnotationType.FREE_HIGHLIGHT:
                editor = new EditorFreeHighlight({
                    konvaStage,
                    pageNumber,
                    annotation,
                    onAdd: (shapeGroup, pdfjsAnnotationStorage) => {
                        this.saveToStore(shapeGroup, pdfjsAnnotationStorage)
                    }
                })
                break
            case AnnotationType.SIGNATURE:
                editor = new EditorSignature(
                    {
                        konvaStage,
                        pageNumber,
                        annotation,
                        onAdd: (shapeGroup, pdfjsAnnotationStorage, annotationContent) => {
                            this.saveToStore(shapeGroup, pdfjsAnnotationStorage, annotationContent)
                            if (annotation.isOnce) {
                                this.setDefaultMode()
                                this.selector.select(shapeGroup.id)
                            }
                        }
                    },
                    this.tempDataTransfer
                )
                break
            case AnnotationType.STAMP:
                editor = new EditorStamp(
                    {
                        konvaStage,
                        pageNumber,
                        annotation,
                        onAdd: (shapeGroup, pdfjsAnnotationStorage, annotationContent) => {
                            this.saveToStore(shapeGroup, pdfjsAnnotationStorage, annotationContent)
                            if (annotation.isOnce) {
                                this.setDefaultMode()
                                this.selector.select(shapeGroup.id)
                            }
                        }
                    },
                    this.tempDataTransfer
                )
                break
            case AnnotationType.SELECT:
                this.selector.activate(pageNumber) // 激活选择器
                break

            default:
                console.warn(`未实现的批注类型: ${annotation.type}`)
                return
        }

        if (editor) {
            this.editorStore.set(editor.id, editor) // 将编辑器实例存储到 editorStore
        }
    }

    /**
     * 启用绘画
     */
    private enablePainting(): void {
        this.konvaCanvasStore.forEach(({ konvaStage, pageNumber }) => {
            // 遍历 KonvaCanvas 实例
            if (this.currentAnnotation) {
                this.enableEditor({
                    konvaStage,
                    pageNumber,
                    annotation: this.currentAnnotation // 启用特定类型的编辑器
                })
            }
        })
    }

    /**
     * 重新绘制批注
     * @param pageNumber - 页码
     */
    private reDrawAnnotation(pageNumber: number): void {
        const konvaCanvasStore = this.konvaCanvasStore.get(pageNumber) // 获取 KonvaCanvas 实例
        const annotationStores = this.store.getByPage(pageNumber) // 获取指定页码的批注存储
        annotationStores.forEach(annotationStore => {
            const storeEditor = this.findEditor(pageNumber, annotationStore.type) // 查找编辑器实例
            if (storeEditor) {
                storeEditor.addSerializedGroupToLayer(konvaCanvasStore.konvaStage, annotationStore.konvaString) // 添加序列化组到图层
            }
        })
    }

    /**
     * 删除批注
     * @param id - 批注 ID
     */
    private deleteAnnotation(id): void {
        const annotationStore = this.store.annotation(id)
        const konvaCanvasStore = this.konvaCanvasStore.get(annotationStore.pageNumber) // 获取 KonvaCanvas 实例
        if (!annotationStore) {
            return
        }
        this.store.delete(id)
        const storeEditor = this.findEditor(annotationStore.pageNumber, annotationStore.type)
        if (storeEditor) {
            storeEditor.deleteGroup(id, konvaCanvasStore.konvaStage)
        }
    }

    /**
     * 关闭绘画
     */
    private disablePainting(): void {
        this.setMode('default') // 设置默认模式
        this.clearTempDataTransfer() // 清除临时数据传输
        this.selector.clear() // 清除选择器
        console.log('Painting mode disabled')
    }

    /**
     * 保存临时数据传输
     * @param data - 数据
     * @returns 临时数据传输
     */
    private saveTempDataTransfer(data: string): string {
        this.tempDataTransfer = data
        return this.tempDataTransfer
    }

    /**
     * 清除临时数据传输
     * @returns 临时数据传输
     */
    private clearTempDataTransfer(): string {
        this.tempDataTransfer = null
        return this.tempDataTransfer
    }

    /**
     * 初始化或更新 KonvaCanvas
     * @param params - 包含当前 PDF 页面视图、是否需要 CSS 转换和页码的对象
     */
    public initCanvas({ pageView, cssTransform, pageNumber }: { pageView: PDFPageView; cssTransform: boolean; pageNumber: number }): void {
        if (cssTransform) {
            this.scaleCanvas(pageView, pageNumber)
        } else {
            this.insertCanvas(pageView, pageNumber)
        }
    }

    /**
     * 初始化 WebSelection
     * @param rootElement - 根 DOM 元素
     */
    public initWebSelection(rootElement: HTMLDivElement): void {
        this.webSelection.create(rootElement)
    }

    /**
     * 激活特定批注类型
     * @param annotation - 批注类型对象
     * @param dataTransfer - 数据传输
     */
    public activate(annotation: IAnnotationType | null, dataTransfer: string | null): void {
        this.currentAnnotation = annotation
        this.disablePainting()
        this.saveTempDataTransfer(dataTransfer)

        if (!annotation) {
            return
        }

        console.log(`Painting mode active type: ${annotation.type} | pdfjs annotationStorage type: ${annotation.pdfjsType}`)
        switch (annotation.type) {
            case AnnotationType.HIGHLIGHT:
            case AnnotationType.STRIKEOUT:
            case AnnotationType.UNDERLINE:
                this.setMode('selection') // 设置选择模式
                break

            case AnnotationType.FREETEXT:
            case AnnotationType.RECTANGLE:
            case AnnotationType.ELLIPSE:
            case AnnotationType.FREEHAND:
            case AnnotationType.FREE_HIGHLIGHT:
            case AnnotationType.SIGNATURE:
            case AnnotationType.STAMP:
            case AnnotationType.SELECT:
                this.setMode('painting') // 设置绘画模式
                break

            default:
                this.setMode('default') // 设置默认模式
                break
        }

        this.enablePainting()
    }

    /**
     * 重置 PDF.js 批注存储
     */
    public resetPdfjsAnnotationStorage(): void {
        this.store.resetAnnotationStorage()
    }
}