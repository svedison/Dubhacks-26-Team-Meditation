// 契约里的 Product 没有图片字段（已写进给用户的接口建议），先按 id 对应本地图片；D 的货架上没有图的商品显示首字母
const IMAGES: Record<string, string> = {
  'calcium-120': '/products/calcium-v1.jpg',
  'glucosamine-usp': '/products/glucosamine-v1.jpg',
  'miracle-joint': '/products/miracle-v1.jpg',
  'b12': '/products/shelf/b12-v1.jpg',
  'brown-rice': '/products/shelf/brown-rice-v1.jpg',
  'fiber-capsules': '/products/shelf/fiber-capsules-v1.jpg',
  'lutein': '/products/shelf/lutein-v1.jpg',
  'magnesium': '/products/shelf/magnesium-v1.jpg',
  'multivitamin': '/products/shelf/multivitamin-v1.jpg',
  'oatmeal': '/products/shelf/oatmeal-v1.jpg',
  'omega-3': '/products/shelf/omega-3-v1.jpg',
  'tea': '/products/shelf/tea-v1.jpg',
  'vitamin-c': '/products/shelf/vitamin-c-v1.jpg',
  'vitamin-d3': '/products/shelf/vitamin-d3-v1.jpg',
}

export function productImage(id: string): string | null {
  return IMAGES[id] ?? null
}
