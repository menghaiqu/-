const DATA_VERSION = '20260930-order-type-1';
const $ = selector => document.querySelector(selector);
const yuan = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const sum = (rows, field) => rows.reduce((total, row) => total + (+row[field] || 0), 0);
const pct = (part, whole) => whole ? `${(part / whole * 100).toFixed(1)}%` : '0.0%';
const seasonOf = value => String(value || '').match(/[春夏秋冬]季/)?.[0] || '未标注';
const yearOf = value => String(value || '').match(/\d{4}年/)?.[0] || '未标注';
const PAGE_SIZE = 10;
const defaultFilters = () => ({ period: 'all', year: '2026年', brand: 'IHIMI', platform: 'all', topChannel: 'all', seasons: ['秋季'], startDate: '', endDate: '', anchor: 'all', category: 'all', status: 'all', search: '' });
const state = { data: null, initialized: false, page: 'autumn', filters: defaultFilters(), sort: { autumn: { key: 'revenue', dir: 'desc' }, reorders: { key: 'reorderValue', dir: 'desc' } }, pagination: { products: 1, autumn: 1, reorders: 1 } };
const compareSort = (a, b, sort) => {
  const left = a[sort.key], right = b[sort.key];
  const result = typeof left === 'string' || typeof right === 'string'
    ? String(left || '').localeCompare(String(right || ''), 'zh-CN', { numeric: true })
    : (+left || 0) - (+right || 0);
  return sort.dir === 'asc' ? result : -result;
};
const sortHead = (label, key, page, tip) => {
  const current = state.sort[page], active = current.key === key;
  const arrow = active ? (current.dir === 'asc' ? '↑' : '↓') : '↕';
  return `<th><button type="button" class="sort-control" data-sort-page="${page}" data-sort-key="${key}" title="${tip}">${label}<span>${arrow}</span></button></th>`;
};
const resetPagination = () => Object.keys(state.pagination).forEach(key => { state.pagination[key] = 1; });
function paginate(rows, key) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, state.pagination[key] || 1), totalPages);
  state.pagination[key] = page;
  const start = (page - 1) * PAGE_SIZE;
  return { page, totalPages, start, rows: rows.slice(start, start + PAGE_SIZE) };
}
function paginationControls(key, pageInfo, count, label) {
  if (!count) return '';
  const pages = new Set([1, pageInfo.totalPages, pageInfo.page - 1, pageInfo.page, pageInfo.page + 1].filter(page => page >= 1 && page <= pageInfo.totalPages));
  const visible = [...pages].sort((a, b) => a - b);
  let buttons = '', last = 0;
  visible.forEach(page => {
    if (page - last > 1) buttons += '<span class="pagination-ellipsis">…</span>';
    buttons += `<button type="button" class="pagination-page ${page === pageInfo.page ? 'active' : ''}" data-list-page="${page}" data-list-key="${key}" aria-label="第 ${page} 页">${page}</button>`;
    last = page;
  });
  return `<nav class="pagination" aria-label="${label}分页"><span class="pagination-summary">共 ${count} 个${label}</span><button type="button" data-list-page="${pageInfo.page - 1}" data-list-key="${key}" ${pageInfo.page === 1 ? 'disabled' : ''}>上一页</button>${buttons}<button type="button" data-list-page="${pageInfo.page + 1}" data-list-key="${key}" ${pageInfo.page === pageInfo.totalPages ? 'disabled' : ''}>下一页</button></nav>`;
}
// These SKUs are present in the inventory workbook as planned inbound stock.
// They have no matched paid order, page price, or cost record yet, so do not
// present the planned quantity as immediately available inventory.
const PENDING_ARRIVAL_CODES = new Set(['I6QZCD01202', 'I6QZCD01280', 'I6QKCD01276']);
function isPendingArrival(code) {
  const normalized = String(code || '').trim().toUpperCase();
  const rows = (state.data?.reorders || []).filter(row => String(row.code || '').trim().toUpperCase() === normalized);
  if (rows.length) return rows.reduce((total, row) => total + (Number(row.arrivedQty) || 0), 0) <= 0;
  return PENDING_ARRIVAL_CODES.has(normalized);
}
// Inventory is the warehouse stock from CD款图片库存.xlsx. Display the
// numeric quantity only; arrival status is intentionally not shown.
const stockLabel = (item) => integer.format(item.stock || 0);
const arrivalStatus = inboundQty => Number(inboundQty) > 0 ? 'arrived' : 'unarrived';
const orderTypeLabel = value => value === '翻单' ? '加翻' : (value || '加翻');

// Excluded from every dashboard display and calculation at the user's request.
const EXCLUDED_PRODUCT_CODES = new Set(['I6XGCD00199']);
const isDashboardProduct = (code) => !EXCLUDED_PRODUCT_CODES.has(String(code || '').trim().toUpperCase());

// The fourth character of the 11-digit colour code is the product-category code.
// The fifth and sixth characters (CD) identify Chengdu self-developed styles.
const CATEGORY_BY_CODE = Object.freeze({
  V: '马夹', J: '棉衣', A: '棉衣', W: '外套', X: '西装', Y: '羽绒服', F: '风衣',
  P: '皮衣', D: '大衣', I: '皮草', H: '卫衣', O: '披肩', C: '衬衫',
  T: 'T恤', M: '毛衫', Z: '针织衫', B: '背心/吊带', E: '小衫',
  K: '休闲裤', N: '牛仔裤', Q: '半身裙', L: '连衣裙', U: '连体裤',
  G: '套装', S: '饰品', R: '鞋子'
});
const categoryForCode = (code, fallback = '未分类') =>
  CATEGORY_BY_CODE[String(code || '').trim().toUpperCase().charAt(3)] || fallback || '未分类';

function products() {
  return new Map(
    state.data.items
      .filter(item => isDashboardProduct(item.code))
      .map(item => [item.code, { ...item, category: categoryForCode(item.code, item.category) }])
  );
}
function passesProductFilters(product, order = {}) {
  const f = state.filters, brand = product.brand || order.brand || '其它品牌';
  const code = product.code || order.code || '';
  return (f.brand === 'all' || f.brand === brand)
    && (f.year === 'all' || f.year === yearOf(product.season))
    && (!f.seasons.length || f.seasons.includes(seasonOf(product.season)))
    && (f.category === 'all' || f.category === product.category)
    && (state.page === 'reorders' || f.status === 'all' || f.status === (product.productTag || '未设置'))
    && (!f.search || `${code} ${order.title || product.title || ''}`.toLowerCase().includes(f.search.toLowerCase()));
}
function activeOrders() {
  const productByCode = products(), f = state.filters;
  return state.data.orders.filter(order => {
    if (!isDashboardProduct(order.code)) return false;
    const product = productByCode.get(order.code) || { code: order.code, brand: order.brand, season: '未标注', category: '未分类' };
    return (f.period === 'all' || order.date.startsWith(f.period))
      && (!f.startDate || order.date >= f.startDate) && (!f.endDate || order.date <= f.endDate)
      && (f.platform === 'all' || f.platform === (order.platform || '抖音'))
      && (f.anchor === 'all' || f.anchor === order.anchor) && passesProductFilters(product, order);
  });
}
function stateTag(item) {
  if (item.reordered) return 'reordered';
  const perDay = item.days ? item.qty / item.days : 0;
  if (perDay >= 5) return 'tested';
  if (perDay > 0 && perDay <= 2) return 'mounted';
  return 'watching';
}
function filteredItems() {
  const productByCode = products(), groups = new Map(), reordered = new Set((state.data.reorders || []).map(row => row.code));
  const arrivedByCode = new Map();
  (state.data.reorders || []).forEach(row => arrivedByCode.set(row.code, (arrivedByCode.get(row.code) || 0) + (Number(row.arrivedQty) || 0)));
  activeOrders().forEach(order => {
    const row = groups.get(order.code) || { qty: 0, revenue: 0, signedQty: 0, channels: new Map(), dates: new Set(), title: '' };
    row.qty += order.qty; row.revenue += order.revenue; row.signedQty += order.signed ? order.qty : 0;
    row.channels.set(order.channel, (row.channels.get(order.channel) || 0) + order.revenue); row.dates.add(order.date); row.title ||= order.title; groups.set(order.code, row);
  });
  const codes = [...productByCode.keys()];
  return codes.map(code => {
    const metrics = groups.get(code) || { qty: 0, revenue: 0, signedQty: 0, channels: new Map(), dates: new Set(), title: '' };
    const top = [...metrics.channels].sort((a, b) => b[1] - a[1])[0];
    const product = productByCode.get(code) || { code, brand: '其它品牌', season: '未标注', category: '未分类', cost: 0, price: 0, stock: 0 };
    const item = { ...product, ...metrics, code, days: metrics.dates.size, signedRate: metrics.qty ? metrics.signedQty / metrics.qty : 0, topChannel: top?.[0] || '暂无渠道数据', topChannelShare: top ? top[1] / metrics.revenue : 0, reordered: reordered.has(code) };
    item.arrivedQty = arrivedByCode.get(code) || 0;
    item.stockValue = (item.stock || 0) * (item.cost || 0);
    item.status = stateTag(item);
    return item;
  }).filter(item => passesProductFilters(item))
    .filter(item => state.page !== 'autumn' || state.filters.topChannel === 'all' || item.topChannel === state.filters.topChannel)
    .sort((a, b) => compareSort(a, b, state.sort.autumn));
}
function chartData(kind, orders) {
  const productByCode = products(), values = new Map();
  orders.forEach(order => { const product = productByCode.get(order.code) || {}; const name = kind === 'channels' ? order.channel : kind === 'seasons' ? product.season || '未匹配商品' : product.category || '未匹配商品'; values.set(name, (values.get(name) || 0) + order.revenue); });
  return [...values].map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue);
}
function renderRanks(id, rows) {
  const total = sum(rows, 'revenue');
  $(id).innerHTML = rows.slice(0, 6).map(row => `<div class="rank-row"><div class="rank-label"><span>${row.name}</span><span>${pct(row.revenue, total)}</span></div><strong>${yuan.format(row.revenue)}</strong><div class="rank-bar"><i style="width:${total ? row.revenue / total * 100 : 0}%"></i></div></div>`).join('') || '<p class="empty-state">暂无匹配数据</p>';
}
function renderMetrics(items) {
  const revenue = sum(items, 'revenue'), qty = sum(items, 'qty'), valid = items.filter(item => item.price && item.cost);
  const multiple = valid.reduce((total, item) => total + item.price, 0) / (valid.reduce((total, item) => total + item.cost, 0) || 1);
  const signed = qty ? sum(items, 'signedQty') / qty : 0;
  const metrics = [['支付销售额', yuan.format(revenue), '去退款后', '已支付订单金额，已剔除退款订单。'], ['净销量', integer.format(qty), '件', '已支付且未退款的商品数量。'], ['倍率', valid.length ? `${multiple.toFixed(2)}倍` : '-', '页面价 / 成本', '按款式页面价格除以成本价计算。'], ['签收率', `${(signed * 100).toFixed(1)}%`, '按净销量', '已签收数量除以净销量。']];
  $('#metrics').innerHTML = metrics.map(row => `<article class="metric has-tip" data-tip="${row[3]}"><p>${row[0]}</p><strong>${row[1]}</strong><span>${row[2]}</span></article>`).join('');
}
function renderTrend(orders) {
  const days = new Map(); orders.forEach(row => days.set(row.date, (days.get(row.date) || 0) + row.revenue));
  const rows = [...days].map(([date, revenue]) => ({ date, revenue })).sort((a, b) => a.date.localeCompare(b.date)).slice(-18), maximum = Math.max(1, ...rows.map(row => row.revenue));
  $('#trend').innerHTML = rows.map(row => `<div class="trend-item"><span class="trend-value">${Math.round(row.revenue / 1000)}k</span><i class="trend-bar" style="height:${Math.max(3, row.revenue / maximum * 142)}px"></i><span>${row.date.slice(5)}</span></div>`).join('');
}
function card(item) {
  const node = $('#product-template').content.cloneNode(true);
  if (item.image) { const image = document.createElement('img'); image.src = item.image; image.alt = item.code; image.loading = 'lazy'; image.decoding = 'async'; const box = node.querySelector('.product-image'); box.classList.add('has-image'); box.replaceChildren(image); }
  node.querySelector('.product-code').textContent = item.code; node.querySelector('.product-revenue').textContent = yuan.format(item.revenue); node.querySelector('.product-qty').textContent = integer.format(item.qty); node.querySelector('.product-stock').textContent = stockLabel(item); node.querySelector('.product-signed-rate').textContent = `${(item.signedRate * 100).toFixed(1)}%`; node.querySelector('.product-price').textContent = item.price ? yuan.format(item.price) : '-'; node.querySelector('.product-multiple').textContent = item.cost && item.price ? `倍率 ${(item.price / item.cost).toFixed(2)}` : '倍率待核'; return node;
}
function productCard(item, index, total, label) {
  const tag = item.status === 'tested' ? '已测' : item.status === 'mounted' ? '挂车' : item.status === 'reordered' ? '已翻' : '观察中';
  const tagClass = item.status === 'tested' ? 'tested' : item.status === 'mounted' ? 'mounted' : 'watching';
  return `<article class="style-row"><span class="rank-number">${index + 1}</span><div class="style-thumb">${item.image ? `<img src="${item.image}" alt="${item.code}" loading="lazy" decoding="async">` : '<span>待同步</span>'}</div><div class="style-main"><div class="style-code-line"><strong>${item.code}</strong><span class="test-tag ${tagClass}">${tag}</span></div><div class="style-meta"><span>销售额 <b>${yuan.format(item.revenue)}</b></span><span>销量 <b>${integer.format(item.qty)}</b></span><span>库存 <b>${integer.format(item.stock || 0)}</b></span><span>签收率 <b>${(item.signedRate * 100).toFixed(1)}%</b></span><span>页面价 <b>${item.price ? yuan.format(item.price) : '-'}</b></span><span>倍率 <b>${item.price && item.cost ? `${(item.price / item.cost).toFixed(2)}x` : '-'}</b></span></div><div class="style-share-area"><div class="style-share-caption"><span>${label}</span><b>${pct(item.revenue, total)}</b></div><div class="style-share"><i style="width:${total ? item.revenue / total * 100 : 0}%"></i></div></div></div></article>`;
}
function renderProducts(items) {
  const rows = items;
  $('#product-count').textContent = `${items.length} 个款式`; $('#autumn-count').textContent = `${rows.length} 个成都自研款`;
  const grid = (id, list, label, key) => {
    const total = sum(list, 'revenue'), pageInfo = paginate(list, key);
    $(id).innerHTML = list.length
      ? `${pageInfo.rows.map((item, index) => productCard(item, pageInfo.start + index, total, label)).join('')}${paginationControls(key, pageInfo, list.length, '款式')}`
      : '<p class="empty-state">当前筛选暂无款式数据</p>';
  };
  const table = (id, list) => {
    const total = sum(list, 'revenue'), pageInfo = paginate(list, 'autumn');
    const rowsHtml = pageInfo.rows.map((item, index) => {
      const tag = item.status === 'tested' ? '已测' : item.status === 'mounted' ? '挂车' : item.status === 'reordered' ? '已翻' : '观察中';
      const tagClass = item.status === 'tested' ? 'tested' : item.status === 'mounted' ? 'mounted' : 'watching';
      return `<tr><td class="sales-image">${item.image ? `<img src="${item.image}" alt="${item.code}" loading="lazy" decoding="async">` : '-'}</td><td><b>${pageInfo.start + index + 1}</b></td><td><strong>${item.code}</strong></td><td>${item.season || '-'}</td><td><b>${yuan.format(item.revenue)}</b></td><td><b>${integer.format(item.qty)}</b></td><td>${(item.signedRate * 100).toFixed(1)}%</td><td>${stockLabel(item)}</td><td>${item.arrivedQty > 0 ? integer.format(item.arrivedQty) : '<b class="not-arrived">未到货</b>'}</td><td>${item.price ? yuan.format(item.price) : '-'}</td><td>${item.cost ? yuan.format(item.cost) : '-'}</td><td>${item.price && item.cost ? `${(item.price / item.cost).toFixed(2)}x` : '-'}</td><td><b>${yuan.format(item.stockValue)}</b></td><td>${item.topChannel || '-'}</td><td>${item.topChannelShare ? `${(item.topChannelShare * 100).toFixed(1)}%` : '0.0%'}</td><td><div class="table-share"><b>${pct(item.revenue, total)}</b><i style="width:${total ? item.revenue / total * 100 : 0}%"></i></div></td></tr>`;
    }).join('');
    $(id).innerHTML = list.length ? `<div class="sales-table-wrap"><table class="sales-table"><thead><tr><th title="款式主图">图片</th><th title="当前排序后的名次">排名</th>${sortHead('款号', 'code', 'autumn', '11 位色号编码。')}${sortHead('季节', 'season', 'autumn', '商品表中的年份季节。')}${sortHead('销售额', 'revenue', 'autumn', '已支付且剔除退款后的销售金额。')}${sortHead('净销量', 'qty', 'autumn', '已支付且未退款的商品数量。')}${sortHead('签收率', 'signedRate', 'autumn', '已签收数量除以净销量。')}${sortHead('库存', 'stock', 'autumn', '当前库存数量来自库存表。')}${sortHead('到仓数量', 'arrivedQty', 'autumn', '翻单明细中的到仓数量合计；为 0 时显示未到货。')}${sortHead('页面价', 'price', 'autumn', '订单文件的商品单价；多价格时取销量最多的价格。')}${sortHead('成本价', 'cost', 'autumn', '库存图片表中的成本价。')}${sortHead('倍率', 'cost', 'autumn', '页面价除以成本价。')}${sortHead('货值', 'stockValue', 'autumn', '当前库存乘以成本价。')}${sortHead('主要渠道', 'topChannel', 'autumn', '该款销售额最高的渠道。')}${sortHead('渠道占比', 'topChannelShare', 'autumn', '主要渠道销售额占该款销售额的比例。')}${sortHead('销售占比', 'revenue', 'autumn', '该款销售额占当前筛选结果总销售额的比例。')}</tr></thead><tbody>${rowsHtml}</tbody></table></div>${paginationControls('autumn', pageInfo, list.length, '款式')}` : '<p class="empty-state">当前筛选暂无款式数据</p>';
  };
  if (state.page === 'products') grid('#products-grid', items.slice(0, 100), 'TOP 100 销售占比', 'products');
  if (state.page === 'autumn') table('#autumn-grid', rows);
}
function filteredReorders() {
  const productByCode = products(), f = state.filters;
  return (state.data.reorders || []).filter(row => {
    if (!isDashboardProduct(row.code) || !passesProductFilters(productByCode.get(row.code) || row, row)) return false;
    const reorderDate = row.reorderDate || row.orderedAt || String(row.createdAt || '').slice(0, 10);
    return (f.period === 'all' || reorderDate.startsWith(f.period))
      && (!f.startDate || reorderDate >= f.startDate) && (!f.endDate || reorderDate <= f.endDate)
      && (f.status === 'all' || arrivalStatus(row.inboundQty) === f.status);
  }).map(row => {
    const item = productByCode.get(row.code) || {};
    const netQty = item.qty || 0, inboundQty = Number(row.inboundQty) || 0;
    return { ...row, netQty, inboundQty, unarrivedQty: inboundQty === 0 ? '未到货' : integer.format(inboundQty), sellThrough: row.reorderQty ? netQty / row.reorderQty : 0, multiple: row.price && row.cost ? row.price / row.cost : 0, remainingValue: (row.stock || 0) * (row.cost || 0) };
  }).sort((a, b) => compareSort(a, b, state.sort.reorders));
}
function itemMap() { return new Map(filteredItems().map(item => [item.code, item])); }
function renderReorderOverview(rows) {
  const byCode = new Map();
  rows.forEach(row => {
    const code = String(row.code || '').toUpperCase();
    const current = byCode.get(code) || { code, reorderQty: 0, inboundQty: 0, reorderValue: 0 };
    current.reorderQty += Number(row.reorderQty) || 0;
    current.inboundQty += Number(row.inboundQty) || 0;
    current.reorderValue += Number(row.reorderValue) || 0;
    byCode.set(code, current);
  });
  // 翻单款数来自翻单记录的 9 位款号；翻单色数覆盖这些款号在商品库存表中的全部 11 位色号。
  // 这样同款不同色（例如 I6DZCD00400 / I6DZCD00402）会计为 1 款、2 色。
  const reorderStyles = new Set([...byCode.keys()].map(code => code.slice(0, 9)));
  const productColors = [...products().values()].filter(item => reorderStyles.has(String(item.code || '').slice(0, 9)));
  for (const item of productColors) {
    const code = String(item.code || '').toUpperCase();
    if (!byCode.has(code)) byCode.set(code, { code, reorderQty: 0, inboundQty: 0, reorderValue: 0 });
  }
  const codes = [...byCode.values()];
  const arrived = codes.filter(row => row.inboundQty > 0);
  const unarrived = codes.filter(row => row.inboundQty <= 0);
  const amount = (rows, field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  const baseCode = code => code.slice(0, 9);
  const distinctBase = rows => new Set(rows.map(row => baseCode(row.code))).size;
  const money = value => yuan.format(value);
  const blocks = [
    { title: '总共翻单货值', arrivedLabel: '到货货值', unarrivedLabel: '未到货货值', total: money(amount(codes, 'reorderValue')), arrived: money(amount(arrived, 'reorderValue')), unarrived: money(amount(unarrived, 'reorderValue')) },
    { title: '总共翻单数量', arrivedLabel: '到货数量', unarrivedLabel: '未到货数量', total: integer.format(amount(codes, 'reorderQty')), arrived: integer.format(amount(codes, 'inboundQty')), unarrived: integer.format(Math.max(0, amount(codes, 'reorderQty') - amount(codes, 'inboundQty'))) },
    { title: '翻单款数 / 色数', paired: [
      { title: '总翻单款数', total: integer.format(distinctBase(codes)), arrivedLabel: '到货款数', arrived: integer.format(distinctBase(arrived)), unarrivedLabel: '未到款数', unarrived: integer.format(distinctBase(unarrived)) },
      { title: '总翻单色数', total: integer.format(codes.length), arrivedLabel: '到货色数', arrived: integer.format(arrived.length), unarrivedLabel: '未到色数', unarrived: integer.format(unarrived.length) }
    ] }
  ];
  $('#reorder-screen-count').textContent = `${codes.length} 个翻单色号 · ${distinctBase(codes)} 个翻单款`;
  $('#reorder-overview-cards').innerHTML = blocks.map(block => block.paired
    ? `<article class="reorder-overview-card reorder-overview-paired"><div class="reorder-overview-title">${block.title}</div><div class="reorder-paired-grid">${block.paired.map(pair => `<div class="reorder-paired-item"><span class="reorder-paired-title">${pair.title}</span><strong class="reorder-overview-total">${pair.total}</strong><div class="reorder-overview-subgrid"><div><span>${pair.arrivedLabel}</span><b>${pair.arrived}</b></div><div><span>${pair.unarrivedLabel}</span><b>${pair.unarrived}</b></div></div></div>`).join('')}</div></article>`
    : `<article class="reorder-overview-card"><div class="reorder-overview-title">${block.title}</div><strong class="reorder-overview-total">${block.total}</strong><div class="reorder-overview-subgrid"><div><span>${block.arrivedLabel}</span><b>${block.arrived}</b></div><div><span>${block.unarrivedLabel}</span><b>${block.unarrived}</b></div></div></article>`).join('');
}
function renderReorders() {
  const rows = filteredReorders(); renderReorderOverview(rows); const pageInfo = paginate(rows, 'reorders'); $('#reorder-count').textContent = `${rows.length} 个翻单批次`;
  const body = pageInfo.rows.map(row => `<tr><td class="table-image">${row.image ? `<img src="${row.image}" alt="${row.code}" loading="lazy">` : '-'}</td><td><b>${row.code}</b><small>${row.orderNo}</small></td><td>${row.brand}</td><td>${row.season || '-'}</td><td>${row.createdAt || '-'}</td><td>${row.deliveryDate || '-'}</td><td>${row.orderType || '翻单'}</td><td>${integer.format(row.reorderQty)}</td><td>${row.inboundQty === 0 ? '<b class="not-arrived">未到货</b>' : integer.format(row.inboundQty)}</td><td>${yuan.format(row.reorderValue)}</td><td>${integer.format(row.netQty)}</td><td>${(row.sellThrough * 100).toFixed(1)}%</td><td>${row.price ? yuan.format(row.price) : '-'}</td><td>${row.multiple ? `${row.multiple.toFixed(2)}x` : '-'}</td><td>${stockLabel(row)}</td><td>${yuan.format(row.remainingValue)}</td></tr>`).join('');
  $('#reorder-list').innerHTML = rows.length ? `<div class="reorder-table-wrap"><table class="reorder-table"><thead><tr><th title="款式图片">图片</th>${sortHead('款号 / 订单', 'code', 'reorders', '11 位色号编码与采购订单号。')}${sortHead('品牌', 'brand', 'reorders', 'IHIMI。')}${sortHead('季节', 'season', 'reorders', '款式年份季节。')}${sortHead('创建时间', 'createdAt', 'reorders', '采购订单创建时间。')}${sortHead('计划交货日期', 'deliveryDate', 'reorders', '采购计划交货日期。')}${sortHead('订单类型', 'orderType', 'reorders', '首单、翻单等采购类型。')}${sortHead('翻单数量', 'reorderQty', 'reorders', '本采购批次的下单数量。')}${sortHead('未到货数量', 'inboundQty', 'reorders', '读取翻单表入库数量；为 0 时标记未到货。')}${sortHead('翻单货值', 'reorderValue', 'reorders', '采购订单货值。')}${sortHead('净销量', 'netQty', 'reorders', '对应款式已支付且未退款的销量。')}${sortHead('售罄率', 'sellThrough', 'reorders', '净销量除以翻单数量。')}${sortHead('页面价格', 'price', 'reorders', '订单文件的商品单价；多价格时取销量最多的价格。')}${sortHead('倍率', 'multiple', 'reorders', '页面价格除以成本价。')}${sortHead('当前库存', 'stock', 'reorders', '当前库存数量来自库存表。')}${sortHead('剩余货值', 'remainingValue', 'reorders', '当前库存乘以成本价。')}</tr></thead><tbody>${body}</tbody></table></div>${paginationControls('reorders', pageInfo, rows.length, '翻单批次')}` : '<p class="empty-state">当前筛选暂无成都自研翻单款</p>';
}
function renderChengduScreen() {
  const sales = itemMap(), grouped = new Map(); filteredReorders().forEach(row => { const item = sales.get(row.code) || {}; const target = grouped.get(row.code) || { ...row, reorderQty: 0, reorderValue: 0, netQty: item.qty || 0, revenue: item.revenue || 0, signedQty: item.signedQty || 0 }; target.reorderQty += row.reorderQty; target.reorderValue += row.reorderValue; grouped.set(row.code, target); });
  const rows = [...grouped.values()], stockItems = filteredItems(), realStockItems = stockItems, reorderQty = sum(rows, 'reorderQty'), netQty = sum(rows, 'netQty'), salesAmount = sum(rows, 'revenue'), reorderValue = sum(rows, 'reorderValue'), stockQty = sum(realStockItems, 'stock'), stockValue = stockItems.reduce((total, item) => total + (item.stock || 0) * (item.cost || 0), 0), signedQty = sum(rows, 'signedQty');
  // 倍率必须跟随当前筛选后的款式与销量变动。以净销量为权重，避免没有销售的
  // 款式把当前周期的倍率拉成固定值；当前范围没有销量时再按款式均值展示。
  const priced = stockItems.filter(item => item.price && item.cost);
  const pricedWithSales = priced.filter(item => item.qty > 0);
  const multipleBase = pricedWithSales.length ? pricedWithSales : priced;
  const multiple = multipleBase.reduce((total, item) => total + item.price * (pricedWithSales.length ? item.qty : 1), 0)
    / (multipleBase.reduce((total, item) => total + item.cost * (pricedWithSales.length ? item.qty : 1), 0) || 1);
  $('#chengdu-screen-count').textContent = `${rows.length} 个成都自研翻单款`;
  const metrics = [['翻单货值', yuan.format(reorderValue), '采购订单货值', '采购表中的翻单货值合计。'], ['剩余货值', yuan.format(stockValue), '当前库存 × 成本', '当前库存数量乘以成本价。'], ['销售额', yuan.format(salesAmount), '去退款后', '对应翻单款的已支付销售额，已剔除退款。'], ['翻单款数', integer.format(rows.length), '按款号去重', '有采购翻单记录的成都自研 11 位色号数量。'], ['净销量', integer.format(netQty), '件', '对应翻单款已支付且未退款的销量。'], ['售罄率', `${(reorderQty ? netQty / reorderQty * 100 : 0).toFixed(1)}%`, '净销量 / 翻单数量', '净销量除以翻单数量。'], ['签收率', `${(netQty ? signedQty / netQty * 100 : 0).toFixed(1)}%`, '净销量口径', '已签收数量除以净销量。'], ['倍率', priced.length ? `${multiple.toFixed(2)}倍` : '-', '页面价 / 成本', pricedWithSales.length ? '当前筛选范围内，按净销量加权的页面价除以成本价。' : '当前筛选范围没有销量，按已录入页面价与成本的款式平均计算。'], ['库存数量', integer.format(stockQty), '真实已到货库存', '仅统计已到货的成都自研款库存；未到货款不计入。']];
  $('#chengdu-metrics').innerHTML = metrics.map(row => `<article class="metric has-tip" data-tip="${row[3]}"><p>${row[0]}</p><strong>${row[1]}</strong><span>${row[2]}</span></article>`).join('');
  renderChengduCharts(stockItems);
}
function renderChengduCharts(items) {
  const stockValue = item => (item.stock || 0) * (item.cost || 0);
  const valueGroups = (rows, key) => [...rows.reduce((map, row) => { const name = key(row) || '未分类'; map.set(name, (map.get(name) || 0) + stockValue(row)); return map; }, new Map())].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const seasonDefs = [['C', '26年春款', 'bar-blue'], ['X', '26年夏款', 'bar-teal'], ['Q', '26年秋款', 'bar-amber']];
  const seasonValues = seasonDefs.map(([marker, name, tone]) => ({ name, tone, value: items.filter(item => item.isChengdu && item.code?.startsWith('I6') && item.code[2] === marker).reduce((total, item) => total + stockValue(item), 0) }));
  const brands = valueGroups(items, item => item.brand);
  const categories = valueGroups(items, item => item.category).slice(0, 8);
  const total = rows => rows.reduce((sumValue, row) => sumValue + row.value, 0);
  const money = value => yuan.format(value);
  const seasonMax = Math.max(...seasonValues.map(row => row.value), 1);
  const barMarkup = seasonValues.map(row => `<div class="value-bar-column chart-hover" tabindex="0" data-tooltip="${row.name}货值：${money(row.value)}"><b>${money(row.value)}</b><div class="value-bar-track"><i class="${row.tone}" style="height:${Math.max(row.value ? 8 : 0, row.value / seasonMax * 100)}%"></i></div><span>${row.name}</span></div>`).join('');
  const palette = ['#4073d8', '#2f9b93', '#e39424', '#7761c8', '#c75263', '#208c78', '#5b83be', '#b97945'];
  const pieTotal = total(brands);
  let offset = 0;
  const stops = brands.map((row, index) => { const start = offset; offset += pieTotal ? row.value / pieTotal * 100 : 0; return `${palette[index % palette.length]} ${start}% ${offset}%`; });
  const pieMarkup = brands.length ? `<div class="value-pie chart-hover" tabindex="0" data-tooltip="当前筛选范围总货值：${money(pieTotal)}" style="background:conic-gradient(${stops.join(',')})"><span>总货值<b>${money(pieTotal)}</b></span></div><div class="value-legend">${brands.map((row, index) => `<div class="chart-hover" tabindex="0" data-tooltip="${row.name}货值：${money(row.value)}，占比 ${pieTotal ? (row.value / pieTotal * 100).toFixed(1) : '0.0'}%"><i style="background:${palette[index % palette.length]}"></i><span>${row.name}</span><em>${pieTotal ? (row.value / pieTotal * 100).toFixed(1) : '0.0'}%</em><b>${money(row.value)}</b></div>`).join('')}</div>` : '<p class="chart-empty">暂无货值数据</p>';
  const categoryMax = Math.max(...categories.map(row => row.value), 1);
  const categoryMarkup = categories.length ? `<div class="category-value-list">${categories.map((row, index) => `<div class="category-value-row chart-hover" tabindex="0" data-tooltip="${row.name}货值：${money(row.value)}"><span>${row.name}</span><i><b style="width:${row.value / categoryMax * 100}%;background:${palette[index % palette.length]}"></b></i><strong>${money(row.value)}</strong></div>`).join('')}</div>` : '<p class="chart-empty">暂无货值数据</p>';
  $('#chengdu-charts').innerHTML = `<div class="chart-section-head"><h3>明细图表</h3></div><div class="chengdu-charts-grid"><article class="value-chart-card"><div class="value-chart-head"><div><h3>26年春夏秋货值</h3><p>按 11 位色号编码识别</p></div><strong>${money(total(seasonValues))}</strong></div><div class="season-value-bars">${barMarkup}</div></article><article class="value-chart-card"><div class="value-chart-head"><div><h3>品牌货值</h3><p>当前筛选范围内品牌库存货值</p></div><strong>${money(pieTotal)}</strong></div><div class="brand-value-chart">${pieMarkup}</div></article><article class="value-chart-card"><div class="value-chart-head"><div><h3>品类货值</h3><p>当前筛选范围内品类库存货值</p></div><strong>${money(total(categories))}</strong></div>${categoryMarkup}</article></div>`;
}
function render() {
  if (!state.data) return; const orders = activeOrders(), items = filteredItems();
  if (state.page === 'overview') { renderMetrics(items); renderTrend(orders); renderRanks('#channels', chartData('channels', orders)); renderRanks('#seasons', chartData('seasons', orders)); renderRanks('#categories', chartData('categories', orders)); $('#top-products').replaceChildren(...items.slice(0, 4).map(card)); }
  if (state.page === 'products' || state.page === 'autumn') renderProducts(items);
  if (state.page === 'autumn') renderChengduScreen();
  if (state.page === 'reorders') renderReorders();
}
function csvCell(value) {
  const normalized = String(value ?? '').replaceAll('"', '""');
  // Prefix formula-like cells so opening the file in Excel cannot execute them.
  return `"${/^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized}"`;
}
function downloadCsv(filename, head, rows) {
  const csv = '\ufeff' + [head.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const reportImageCache = new Map();
async function inlineReportImage(src) {
  if (!src) return '';
  if (src.startsWith('data:')) return src;
  if (!reportImageCache.has(src)) {
    reportImageCache.set(src, fetch(src).then(response => {
      if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
      return response.blob();
    }).then(blob => new Promise(resolve => {
      const lowerSrc = src.toLowerCase();
      const mime = lowerSrc.endsWith('.png') ? 'image/png' : lowerSrc.endsWith('.jpg') || lowerSrc.endsWith('.jpeg') ? 'image/jpeg' : 'image/webp';
      const imageBlob = blob.type.startsWith('image/') ? blob : new Blob([blob], { type: mime });
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(imageBlob);
    })).catch(() => ''));
  }
  return reportImageCache.get(src);
}
function reportFilters() {
  const f = state.filters;
  const parts = [
    f.period === 'all' ? '全部月份' : `${Number(f.period.slice(5))}月`, f.year === 'all' ? '全部年份' : f.year,
    f.brand === 'all' ? '全部品牌' : f.brand, f.seasons.length ? f.seasons.join('、') : '全部季节',
    f.platform === 'all' ? '全部平台' : f.platform, f.category === 'all' ? '全部品类' : f.category
  ];
  if (f.startDate || f.endDate) parts.push(`${f.startDate || '开始'} 至 ${f.endDate || '结束'}`);
  if (f.search) parts.push(`搜索：${f.search}`);
  return parts.join(' / ');
}
function reportBarRows(entries, total) {
  const max = Math.max(...entries.map(row => row.value), 1);
  return entries.map(row => `<div class="bar-row"><span>${escapeHtml(row.name)}</span><i><b style="width:${row.value / max * 100}%"></b></i><strong>${yuan.format(row.value)}</strong><em>${total ? (row.value / total * 100).toFixed(1) : '0.0'}%</em></div>`).join('');
}
function saveHtmlReport(filename, html) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadTable() {
  const isReorders = state.page === 'reorders';
  const rows = isReorders ? filteredReorders() : filteredItems();
  const imageUrl = image => image ? new URL(image, location.href).href : '';
  const head = isReorders
    ? ['图片链接', '色号编码', '订单号', '品牌', '季节', '创建时间', '计划交货日期', '订单类型', '翻单数量', '未到货数量', '翻单货值', '净销量', '售罄率', '页面价格', '成本价', '倍率', '当前库存', '剩余货值']
    : ['图片链接', '色号编码', '季节', '品类', '商品标签', '销售额', '净销量', '签收率', '库存', '到仓数量', '页面价格', '成本价', '倍率', '货值', '主要渠道', '渠道占比'];
  const data = rows.map(row => isReorders
    ? [imageUrl(row.image), row.code, row.orderNo, row.brand, row.season || '', row.createdAt || '', row.deliveryDate || '', row.orderType || '翻单', row.reorderQty, row.inboundQty === 0 ? '未到货' : row.inboundQty, row.reorderValue, row.netQty, `${(row.sellThrough * 100).toFixed(1)}%`, row.price || '', row.cost || '', row.multiple ? `${row.multiple.toFixed(2)}x` : '', row.stock || 0, row.remainingValue]
    : [imageUrl(row.image), row.code, row.season || '', row.category || '', row.productTag || '未设置', row.revenue, row.qty, `${(row.signedRate * 100).toFixed(1)}%`, row.stock || 0, row.arrivedQty > 0 ? row.arrivedQty : '未到货', row.price || '', row.cost || '', row.price && row.cost ? `${(row.price / row.cost).toFixed(2)}x` : '', row.stockValue, row.topChannel || '', `${(row.topChannelShare * 100).toFixed(1)}%`]);
  downloadCsv(`${isReorders ? '成都翻单明细' : '成都款式销售'}_${new Date().toISOString().slice(0, 10)}.csv`, head, data);
}
async function download() {
  const button = $('#download');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '正在生成图文报告...';
  try {
    const date = new Date().toISOString().slice(0, 10);
    const isReorders = state.page === 'reorders';
    const items = filteredItems();
    const reorders = filteredReorders();
    const imageSources = isReorders ? reorders.map(row => row.image) : items.map(item => item.image);
    const embeddedImages = await Promise.all(imageSources.map(inlineReportImage));
    const totalRevenue = sum(items, 'revenue');
    const totalStockValue = sum(items, 'stockValue');
    const totalReorderValue = sum(reorders, 'reorderValue');
    const totalReorderQty = sum(reorders, 'reorderQty');
    const totalQty = sum(items, 'qty');
    const metricRows = isReorders
      ? [['翻单批次', integer.format(reorders.length)], ['翻单数量', integer.format(totalReorderQty)], ['翻单货值', yuan.format(totalReorderValue)], ['净销量', integer.format(sum(reorders, 'netQty'))], ['售罄率', `${(totalReorderQty ? sum(reorders, 'netQty') / totalReorderQty * 100 : 0).toFixed(1)}%`], ['剩余货值', yuan.format(sum(reorders, 'remainingValue'))]]
      : [['销售额', yuan.format(totalRevenue)], ['净销量', integer.format(totalQty)], ['库存数量', integer.format(sum(items, 'stock'))], ['库存货值', yuan.format(totalStockValue)], ['签收率', `${(totalQty ? sum(items, 'signedQty') / totalQty * 100 : 0).toFixed(1)}%`], ['翻单货值', yuan.format(totalReorderValue)]];
    const seasonal = [['C', '26年春款'], ['X', '26年夏款'], ['Q', '26年秋款'], ['D', '26年冬款']].map(([marker, name]) => ({ name, value: items.filter(item => item.code?.startsWith('I6') && item.code[2] === marker).reduce((total, item) => total + item.stockValue, 0) }));
    const grouped = (key) => [...items.reduce((map, item) => { const name = key(item) || '未分类'; map.set(name, (map.get(name) || 0) + item.stockValue); return map; }, new Map())].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const title = isReorders ? '成都翻单明细图文报告' : '成都自研款图文报告';
    const detailRows = isReorders ? reorders.map((row, index) => `<tr><td>${embeddedImages[index] ? `<img src="${embeddedImages[index]}" alt="${escapeHtml(row.code)}">` : '-'}</td><td><b>${escapeHtml(row.code)}</b><small>${escapeHtml(row.orderNo)}</small></td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.season || '-')}</td><td>${escapeHtml(row.createdAt || '-')}</td><td>${escapeHtml(row.deliveryDate || '-')}</td><td>${escapeHtml(row.orderType || '翻单')}</td><td>${integer.format(row.reorderQty)}</td><td>${row.inboundQty === 0 ? '未到货' : integer.format(row.inboundQty)}</td><td>${yuan.format(row.reorderValue)}</td><td>${integer.format(row.netQty)}</td><td>${(row.sellThrough * 100).toFixed(1)}%</td><td>${row.price ? yuan.format(row.price) : '-'}</td><td>${row.multiple ? `${row.multiple.toFixed(2)}x` : '-'}</td><td>${escapeHtml(stockLabel(row))}</td><td>${yuan.format(row.remainingValue)}</td></tr>`).join('') : items.map((item, index) => {
      const status = item.status === 'tested' ? '已测' : item.status === 'mounted' ? '挂车' : item.status === 'reordered' ? '已翻' : '观察中';
      return `<tr><td>${embeddedImages[index] ? `<img src="${embeddedImages[index]}" alt="${escapeHtml(item.code)}">` : '-'}</td><td><b>${escapeHtml(item.code)}</b></td><td>${escapeHtml(item.brand)}</td><td>${escapeHtml(item.season || '-')}</td><td>${escapeHtml(item.category || '-')}</td><td>${yuan.format(item.revenue)}</td><td>${integer.format(item.qty)}</td><td>${(item.signedRate * 100).toFixed(1)}%</td><td>${escapeHtml(stockLabel(item, true))}</td><td>${item.price ? yuan.format(item.price) : '-'}</td><td>${item.cost ? yuan.format(item.cost) : '-'}</td><td>${item.multiple ? `${item.multiple.toFixed(2)}x` : '-'}</td><td>${yuan.format(item.stockValue)}</td><td>${escapeHtml(item.topChannel || '-')}</td><td>${(item.topChannelShare * 100).toFixed(1)}%</td><td>${status}</td></tr>`;
    }).join('');
    const tableHead = isReorders ? ['图片', '色号编码 / 订单', '品牌', '季节', '创建时间', '计划交货日期', '订单类型', '翻单数量', '未到货数量', '翻单货值', '净销量', '售罄率', '页面价格', '倍率', '当前库存', '剩余货值'] : ['图片', '11位色号编码', '品牌', '季节', '品类', '销售额', '净销量', '签收率', '库存', '页面价格', '成本价', '倍率', '货值', '主要渠道', '渠道占比', '状态'];
    const chartTotal = rows => rows.reduce((total, row) => total + row.value, 0);
    const chartContent = isReorders ? '' : `<section class="charts"><h2>明细图表</h2><div class="charts-grid"><article><h3>26年春夏秋冬货值</h3><p>按 11 位色号编码识别</p>${reportBarRows(seasonal, chartTotal(seasonal))}</article><article><h3>品牌货值</h3><p>当前筛选范围内品牌库存货值</p>${reportBarRows(grouped(item => item.brand), totalStockValue)}</article><article><h3>品类货值</h3><p>当前筛选范围内品类库存货值</p>${reportBarRows(grouped(item => item.category), totalStockValue)}</article></div></section>`;
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f4f7fb;color:#132238;font:14px/1.5 Arial,"Microsoft YaHei",sans-serif}main{max-width:1500px;margin:auto;padding:32px}.header{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #dce8fb;padding-bottom:20px}.header h1{margin:0;color:#102b58;font-size:28px}.header p{margin:8px 0 0;color:#5d718e}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:24px 0}.metric,.charts article,.detail{background:#fff;border:1px solid #cdddf6;border-radius:10px;box-shadow:0 8px 24px rgba(39,76,127,.06)}.metric{padding:16px}.metric p,.charts p{margin:0;color:#61728a;font-size:12px}.metric strong{display:block;margin-top:8px;font-size:26px;color:#063d57}.charts h2{font-size:20px}.charts-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.charts article{padding:18px}.charts h3{margin:0 0 5px;color:#102b58}.bar-row{display:grid;grid-template-columns:72px 1fr 90px 48px;align-items:center;gap:8px;margin:13px 0}.bar-row i{height:9px;background:#e9f0f8;border-radius:999px;overflow:hidden}.bar-row b{display:block;height:100%;border-radius:inherit;background:#4777d8}.bar-row strong,.bar-row em{font-style:normal;text-align:right;color:#0b4d77}.detail{margin-top:24px;padding:18px;overflow:auto}.detail h2{margin:0 0 16px;color:#102b58}table{border-collapse:collapse;width:100%;min-width:1320px}th{background:#f0f5fd;color:#365379;text-align:left;font-size:12px}th,td{border-bottom:1px solid #dce7f5;padding:10px;white-space:nowrap}td img{width:52px;height:64px;object-fit:cover;border-radius:5px;display:block}td small{display:block;color:#6d8098}@media(max-width:800px){main{padding:16px}.metrics,.charts-grid{grid-template-columns:1fr}.header{display:block}}</style></head><body><main><header class="header"><div><h1>${title}</h1><p>导出时间：${new Date().toLocaleString('zh-CN')} · 筛选条件：${escapeHtml(reportFilters())}</p></div><p>数据条数：${isReorders ? reorders.length : items.length}</p></header><section class="metrics">${metricRows.map(([name, value]) => `<article class="metric"><p>${name}</p><strong>${value}</strong></article>`).join('')}</section>${chartContent}<section class="detail"><h2>${isReorders ? '翻单批次明细' : '成都自研款式明细'}</h2><table><thead><tr>${tableHead.map(head => `<th>${head}</th>`).join('')}</tr></thead><tbody>${detailRows}</tbody></table></section></main></body></html>`;
    saveHtmlReport(`${title}_${date}.html`, html);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}
function configureStatusFilter(page) {
  const select = $('#status'), label = $('#status-filter-label span');
  const isReorders = page === 'reorders';
  const options = isReorders
    ? [['all', '全部状态'], ['arrived', '到货'], ['unarrived', '未到货']]
    : [['all', '全部商品标签'], ...[...new Set([...products().values()].map(item => item.productTag || '未设置'))].sort().map(tag => [tag, tag])];
  label.textContent = isReorders ? '状态' : '商品标签';
  select.replaceChildren(...options.map(([value, text]) => Object.assign(document.createElement('option'), { value, textContent: text })));
  state.filters.status = 'all';
  select.value = 'all';
}
function configureTopChannelFilter(page) {
  const wrapper = $('#top-channel-filter'), select = $('#topChannel');
  if (!wrapper || !select) return;
  const visible = page === 'autumn';
  wrapper.hidden = !visible;
  const channels = [...new Set((state.data.orders || []).map(order => order.channel || '暂无渠道数据').filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  select.replaceChildren(...[['all', '全部主要渠道'], ...channels.map(channel => [channel, channel])]
    .map(([value, text]) => Object.assign(document.createElement('option'), { value, textContent: text })));
  select.value = state.filters.topChannel || 'all';
}
function init() {
  if (state.initialized) return; state.initialized = true; const items = state.data.items, dates = state.data.daily.map(row => row.date).sort();
  const add = (id, values) => $(id).insertAdjacentHTML('beforeend', values.map(value => `<option value="${value}">${value}</option>`).join(''));
  add('#year', [...new Set(items.map(item => yearOf(item.season)).filter(value => value !== '未标注'))].sort().reverse()); add('#brand', [...new Set(items.map(item => item.brand).filter(Boolean))].sort());
  add('#platform', [...new Set(state.data.orders.map(order => order.platform || '抖音').filter(Boolean))].sort());
  $('#period').innerHTML += [...new Set(dates.map(date => date.slice(0, 7)))].sort().reverse().map(month => `<option value="${month}">${Number(month.slice(5))}月</option>`).join('');
  // Category is derived from the fourth character of the colour code when
  // the source workbook leaves its category field blank.
  add('#category', [...new Set([...products().values()].map(item => item.category).filter(Boolean))].sort());
  configureStatusFilter(state.page);
  const refreshSelect = id => event => {
    state.filters[id] = event.target.value;
    resetPagination();
    render();
  };
  ['period', 'year', 'brand', 'platform', 'topChannel', 'category', 'status'].forEach(id => {
    const input = $("#" + id);
    input.addEventListener('change', refreshSelect(id));
    input.addEventListener('input', refreshSelect(id));
  });
  const menu = $('#season-menu'), toggle = $('#season-toggle');
  ['year', 'brand'].forEach(id => { $("#" + id).value = state.filters[id]; });
  menu.querySelectorAll('input').forEach(input => { input.checked = state.filters.seasons.includes(input.value); });
  $('#season-label').textContent = state.filters.seasons.join('、');
  toggle.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); }); menu.addEventListener('change', () => { state.filters.seasons = [...menu.querySelectorAll('input:checked')].map(input => input.value); $('#season-label').textContent = state.filters.seasons.length ? state.filters.seasons.join('、') : '全部季节'; resetPagination(); render(); }); document.addEventListener('click', event => { if (!$('#season-filter').contains(event.target)) { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-sort-page]');
    if (!button) return;
    const current = state.sort[button.dataset.sortPage], key = button.dataset.sortKey;
    state.sort[button.dataset.sortPage] = { key, dir: current.key === key && current.dir === 'desc' ? 'asc' : 'desc' };
    state.pagination[button.dataset.sortPage] = 1;
    render();
  });
  const imagePreview = $('#image-preview'), imagePreviewContent = $('#image-preview-content');
  document.addEventListener('click', event => {
    const image = event.target.closest('.sales-image img, .table-image img, .style-thumb img, .product-image img');
    if (!image) return;
    imagePreviewContent.src = image.currentSrc || image.src;
    imagePreviewContent.alt = image.alt || '商品图片大图';
    imagePreview.showModal();
  });
  imagePreview.addEventListener('click', event => {
    if (event.target === imagePreview || event.target.closest('.image-preview-close')) imagePreview.close();
  });
  imagePreview.addEventListener('close', () => imagePreviewContent.removeAttribute('src'));
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-list-page]');
    if (!control || control.disabled) return;
    state.pagination[control.dataset.listKey] = Number(control.dataset.listPage);
    render();
  });
  ['startDate', 'endDate'].forEach(id => { const input = $("#" + id); input.min = dates[0] || ''; input.max = dates.at(-1) || ''; input.addEventListener('change', event => { state.filters[id] = event.target.value; resetPagination(); render(); }); }); $('#search').addEventListener('input', event => { state.filters.search = event.target.value.trim(); resetPagination(); render(); }); $('#download').addEventListener('click', downloadTable);
  $('#reset').addEventListener('click', () => { state.filters = defaultFilters(); configureStatusFilter(state.page); configureTopChannelFilter(state.page); resetPagination(); document.querySelectorAll('.filters select').forEach(select => select.value = state.filters[select.id] || 'all'); menu.querySelectorAll('input').forEach(input => input.checked = state.filters.seasons.includes(input.value)); $('#season-label').textContent = state.filters.seasons.join('、'); $('#startDate').value = ''; $('#endDate').value = ''; $('#search').value = ''; render(); });
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { showPage(button.dataset.page); render(); })); document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => { showPage(button.dataset.go); render(); }));
}
function showPage(page) {
  state.page = page;
  if (page === 'reorders') {
    state.filters.seasons = ['春季', '夏季', '秋季', '冬季'];
    $('#season-label').textContent = '春季、夏季、秋季、冬季';
    $('#season-menu')?.querySelectorAll('input').forEach(input => { input.checked = true; });
  } else if (page === 'autumn') {
    state.filters.seasons = ['秋季'];
    $('#season-label').textContent = '秋季';
    $('#season-menu')?.querySelectorAll('input').forEach(input => { input.checked = input.value === '秋季'; });
  }
  configureStatusFilter(page);
  configureTopChannelFilter(page);
  document.getElementById(`filters-${page}`)?.append($('#filters'));
  document.querySelectorAll('.page').forEach(node => node.classList.toggle('active-page', node.id === page));
  document.querySelectorAll('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.page === page));
  const pageTitle = $('#page-title');
  if (pageTitle) pageTitle.textContent = ({ overview: '销售总览', products: '款式销售', autumn: '秋季新款', reorders: '翻单明细' })[page] || 'IHIMI销售看板';
}
async function loadDashboard() { if (globalThis.__DASHBOARD_DATA__) return globalThis.__DASHBOARD_DATA__; const response = await fetch(`data/dashboard.json.gz?v=${DATA_VERSION}`, { cache: 'no-cache' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); if (response.headers.get('content-encoding') === 'gzip') return response.json(); if (!('DecompressionStream' in globalThis)) throw new Error('当前浏览器不支持压缩数据'); return JSON.parse(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text()); }
loadDashboard().then(data => { state.data = data; (state.data.reorders || []).forEach(row => { row.orderType = orderTypeLabel(row.orderType); }); $('#update-time').textContent = `更新于 ${data.updatedAt.replace('T', ' ')}`; init(); showPage('autumn'); render(); }).catch(error => { document.body.innerHTML = `<p style="padding:40px">数据载入失败：${error.message}</p>`; });
