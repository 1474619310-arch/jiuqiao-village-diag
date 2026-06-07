const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// ====== 配置区（通过环境变量设置，无需改代码） ======
// 企业微信群机器人 Webhook
const WECOM_WEBHOOK_URL = process.env.WECOM_WEBHOOK || '';
// 腾讯文档智能表格
const TENCENT_DOCS_SHEET_ID = process.env.SHEET_ID || '';
const TENCENT_DOCS_TOKEN = process.env.DOCS_TOKEN || '';
// 管理员密码（查看/导出数据用）
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'jiuqiao2026';
// =====================

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ====== 数据存储 ======
const DATA_FILE = path.join(__dirname, 'data', 'submissions.json');

function ensureDataFile() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
}

function loadAll() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch { return []; }
}

function saveAll(arr) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2), 'utf-8');
}

function addRecord(data) {
  const all = loadAll();
  all.push(data);
  saveAll(all);
}

// ====== 企业微信通知 ======
async function sendWecomNotify(data) {
  if (!WECOM_WEBHOOK_URL) {
    console.log('[企业微信] 未配置Webhook，跳过');
    return false;
  }
  try {
    const totalScore = data.totalScore || '—';
    const worstDim = data.worstDim || '—';
    const villageName = data.villageName || '未填写';
    const region = data.region || '未填写';
    const phone = data.phone || '未填写';
    const projectType = data.projectType || '未填写';
    const submitTime = data.submitTime || '—';

    const msg = {
      msgtype: 'markdown',
      markdown: {
        content: `## 🎯 新的诊断表提交\n> **项目：${villageName}**（${region}）\n> **类型：${projectType}**\n> **总分：<font color="info">${totalScore}</font>/5.0**\n> **最弱维度：<font color="warning">${worstDim}</font>**\n> **手机号：<font color="info">${phone}</font>**\n> **提交时间：${submitTime}**`
      }
    };

    await axios.post(WECOM_WEBHOOK_URL, msg, { timeout: 10000 });
    console.log('[企业微信] 通知发送成功');
    return true;
  } catch (e) {
    console.error('[企业微信] 通知发送失败:', e.message);
    return false;
  }
}

// ====== 腾讯文档 ======
async function writeToDocs(data) {
  if (!TENCENT_DOCS_TOKEN || !TENCENT_DOCS_SHEET_ID) {
    console.log('[腾讯文档] 未配置，跳过');
    return false;
  }
  try {
    const url = `https://docs.qq.com/open/document/app/smartsheet/v2/sheets/${TENCENT_DOCS_SHEET_ID}/records`;
    const fields = {};
    Object.entries(data).forEach(([k, v]) => { fields[k] = String(v); });
    await axios.post(url, { fields }, {
      headers: { Authorization: `Bearer ${TENCENT_DOCS_TOKEN}` }
    });
    console.log('[腾讯文档] 写入成功');
    return true;
  } catch (e) {
    console.error('[腾讯文档] 写入失败:', e.message);
    return false;
  }
}

// ====== API 路由 ======

// 提交诊断数据
app.post('/api/submit', async (req, res) => {
  try {
    const data = req.body;
    data.submitTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    data.ip = req.headers['x-forwarded-for'] || req.ip || '';
    data.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    console.log('\n[新提交]', data.villageName, data.phone);

    // 1. 保存到本地
    addRecord(data);

    // 2. 写腾讯文档（如已配置）
    const docsOk = await writeToDocs(data);

    // 3. 发企业微信通知（如已配置）
    const notified = await sendWecomNotify(data);

    res.json({ success: true, message: '提交成功', docsSaved: docsOk, notified });
  } catch (e) {
    console.error('[错误]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 查看所有提交（需密码）
app.get('/api/submissions', (req, res) => {
  const pwd = req.query.password || req.headers['x-admin-password'] || '';
  if (pwd !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '需要管理员密码' });
  }
  const all = loadAll();
  res.json(all);
});

// 导出 Excel（需密码）
app.get('/api/export', (req, res) => {
  const pwd = req.query.password || req.headers['x-admin-password'] || '';
  if (pwd !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '需要管理员密码' });
  }
  const all = loadAll();
  if (!all.length) return res.send('暂无数据');

  // 按顺序整理字段，中文表头
  const fieldMap = [
    ['id', '记录ID'],
    ['submitTime', '提交时间'],
    ['villageName', '村庄名称'],
    ['region', '所在地区'],
    ['phone', '手机号'],
    ['wechat', '微信号'],
    ['projectType', '项目类型'],
    ['areaSize', '面积规模'],
    ['population', '常住人口'],
    ['visitors', '年客流量'],
    ['formats', '已有业态'],
    ['revenue', '年营收'],
    ['teamSize', '团队人数'],
    ['stage', '当前阶段'],
    ['decision', '决策人'],
    ['urgent', '最迫切问题'],
    ['totalScore', '总分'],
    ['worstDim', '最弱维度'],
    ['dimensionScores.调研与品牌定位', '调研与品牌定位'],
    ['dimensionScores.产品与内容设计', '产品与内容设计'],
    ['dimensionScores.宣传与引流', '宣传与引流'],
    ['dimensionScores.活动策划', '活动策划'],
    ['dimensionScores.产业运营', '产业运营'],
    ['ip', 'IP地址'],
  ];

  const headers = fieldMap.map(f => f[1]);
  const rows = all.map(r => {
    return fieldMap.map(f => {
      const key = f[0];
      if (key.startsWith('dimensionScores.')) {
        const dim = key.replace('dimensionScores.', '');
        const ds = r.dimensionScores || {};
        return ds[dim] !== undefined ? ds[dim] : '';
      }
      return r[key] !== undefined ? String(r[key]) : '';
    });
  });

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // 设置列宽
  ws['!cols'] = headers.map(() => ({ wch: 18 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '诊断数据');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="jiuqiao-diag-data.xlsx"');
  res.send(buf);
});

// 数据统计
app.get('/api/stats', (req, res) => {
  const all = loadAll();
  res.json({
    total: all.length,
    latest: all.length ? all[all.length - 1].submitTime : null,
    phones: all.map(r => r.phone).filter(Boolean)
  });
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n✅ 九桥诊断表服务启动成功！`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   提交: POST /api/submit`);
  console.log(`   数据: GET  /api/submissions?password=${ADMIN_PASSWORD}`);
  console.log(`   导出: GET  /api/export?password=${ADMIN_PASSWORD}\n`);
});
