// 邮件产品卡 HTML（客户端可用，不依赖 prisma）。样式与 email-blocks 的产品卡统一。
// 价格旁的「*」对应邮件底部统一的价格脚注（priceFootnote）。

const GOLD = "#d4a72c";
const INK = "#1a1a1a";

// 价格旁的星号标记（对应底部脚注）
const STAR = `<span style="color:${GOLD};font-size:12px;font-weight:700;">*</span>`;
// 统一金色按钮
function goldBtn(label: string, url: string) {
  return `<a href="${url}" style="display:inline-block;background:${GOLD};color:${INK};font-weight:700;font-size:11px;letter-spacing:.5px;text-transform:uppercase;padding:9px 18px;border-radius:6px;text-decoration:none;">${label}</a>`;
}

// 推荐产品卡：选定具体商品后生成（标题/图/价/链接为静态）
export function productCard(p: { title: string; image: string; price: string; url: string }) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eaeaea;border-radius:12px;overflow:hidden;margin:12px 0">
  <tr>
    ${p.image ? `<td class="bis-col" width="140" style="padding:0;vertical-align:top"><img class="bis-img" src="${p.image}" width="140" style="width:140px;height:140px;object-fit:cover;display:block;border:0;background:#1c1f26"></td>` : ""}
    <td class="bis-col bis-center-sm" style="padding:16px 18px;vertical-align:top">
      <div style="font-size:15px;font-weight:700;color:${INK};line-height:1.35">${p.title}</div>
      ${p.price ? `<div style="font-size:16px;font-weight:700;color:${INK};margin-top:8px">${p.price} ${STAR}</div>` : ""}
      <div style="margin-top:12px">${goldBtn("View product", p.url)}</div>
    </td>
  </tr>
</table>`;
}

// 客人订阅的产品卡（带变量，发送时每人按自己的订阅渲染）
export const CUSTOMER_CARD = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eaeaea;border-radius:12px;overflow:hidden;margin:12px 0">
  <tr>
    {{#if product_image}}<td class="bis-col" width="140" style="padding:0;vertical-align:top"><img class="bis-img" src="{{product_image}}" width="140" style="width:140px;height:140px;object-fit:cover;display:block;border:0;background:#1c1f26"></td>{{/if}}
    <td class="bis-col bis-center-sm" style="padding:16px 18px;vertical-align:top">
      <div style="font-size:15px;font-weight:700;color:${INK};line-height:1.35">{{product_title}}</div>
      {{#if variant_title}}<div style="font-size:12px;color:#888;margin-top:4px">{{variant_title}}</div>{{/if}}
      {{#if product_price}}<div style="font-size:16px;font-weight:700;color:${INK};margin-top:8px">{{product_price}} ${STAR}</div>{{/if}}
      <div style="margin-top:12px">${goldBtn("View product", "{{product_url}}")}</div>
    </td>
  </tr>
</table>`;
