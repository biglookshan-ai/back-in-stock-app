// 邮件产品卡 HTML（客户端可用，不依赖 prisma）。颜色用 {{brand_color}} 变量按品牌渲染。
// 水平内边距由正文单元格统一提供，这里只留上下 margin。

// 推荐产品卡：选定具体商品后生成（标题/图/价/链接为静态）
export function productCard(p: { title: string; image: string; price: string; url: string }) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;overflow:hidden;margin:12px 0">
  <tr>
    ${p.image ? `<td width="120" style="padding:0"><img src="${p.image}" width="120" style="width:120px;height:120px;object-fit:cover;display:block;border:0"></td>` : ""}
    <td style="padding:14px 16px;vertical-align:top">
      <div style="font-size:15px;font-weight:700;color:#1a1a1a">${p.title}</div>
      ${p.price ? `<div style="font-size:14px;font-weight:600;color:{{brand_color}};margin-top:6px">${p.price}</div>` : ""}
      <a href="${p.url}" style="display:inline-block;margin-top:10px;background:{{brand_color}};color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;font-size:13px">View product</a>
    </td>
  </tr>
</table>`;
}

// 客人订阅的产品卡（带变量，发送时每人按自己的订阅渲染）
export const CUSTOMER_CARD = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;overflow:hidden;margin:12px 0">
  <tr>
    {{#if product_image}}<td width="120" style="padding:0"><img src="{{product_image}}" width="120" style="width:120px;height:120px;object-fit:cover;display:block;border:0"></td>{{/if}}
    <td style="padding:14px 16px;vertical-align:top">
      <div style="font-size:15px;font-weight:700;color:#1a1a1a">{{product_title}}</div>
      {{#if variant_title}}<div style="font-size:13px;color:#888;margin-top:4px">{{variant_title}}</div>{{/if}}
      {{#if product_price}}<div style="font-size:14px;font-weight:600;color:{{brand_color}};margin-top:6px">{{product_price}}</div>{{/if}}
      <a href="{{product_url}}" style="display:inline-block;margin-top:10px;background:{{brand_color}};color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;font-size:13px">View product</a>
    </td>
  </tr>
</table>`;
