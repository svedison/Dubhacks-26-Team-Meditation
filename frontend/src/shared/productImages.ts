// 契约里的 Product 没有图片字段（已写进给用户的接口建议），先按 id 对应本地图片
const IMAGES: Record<string, string> = {
  'calcium-120': '/products/calcium-v1.jpg',
  'glucosamine-usp': '/products/glucosamine-v1.jpg',
  'miracle-joint': '/products/miracle-v1.jpg',
}

export function productImage(id: string): string | null {
  return IMAGES[id] ?? null
}
