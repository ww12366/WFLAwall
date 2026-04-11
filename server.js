import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('*', cors());

let dbData = { users: [], restaurants: [] };

async function loadData() {
  try {
    const stored = await RESTAURANT_DB.get('alldata');
    if (stored) {
      dbData = JSON.parse(stored);
    }
  } catch (e) {
    console.log('Using default data');
  }
}

async function saveData() {
  try {
    await RESTAURANT_DB.put('alldata', JSON.stringify(dbData));
  } catch (e) {
    console.log('Cannot save to KV in dev mode');
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function hashPassword(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

app.post('/api/register', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) {
    return c.json({ error: '请输入用户名和密码' }, 400);
  }
  await loadData();
  if (dbData.users.find(u => u.username === username)) {
    return c.json({ error: '用户名已存在' }, 400);
  }
  const user = { id: generateId(), username, password: hashPassword(password) };
  dbData.users.push(user);
  await saveData();
  return c.json({ success: true, user: { id: user.id, username: user.username } });
});

app.post('/api/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) {
    return c.json({ error: '请输入用户名和密码' }, 400);
  }
  await loadData();
  const user = dbData.users.find(u => u.username === username && u.password === hashPassword(password));
  if (!user) {
    return c.json({ error: '用户名或密码错误' }, 401);
  }
  return c.json({ success: true, user: { id: user.id, username: user.username } });
});

app.get('/api/restaurants', async (c) => {
  await loadData();
  const restaurants = dbData.restaurants.map(r => ({
    id: r.id,
    name: r.name,
    address: r.address,
    images: r.images || [],
    createdBy: r.createdBy,
    commentCount: r.comments.length,
    createdAt: r.createdAt
  }));
  return c.json(restaurants);
});

app.post('/api/restaurants', async (c) => {
  const formData = await c.req.formData();
  const name = formData.get('name')?.toString();
  const address = formData.get('address')?.toString();
  const username = formData.get('username')?.toString();
  
  if (!name || !address) {
    return c.json({ error: '请填写餐厅名称和地址' }, 400);
  }
  
  await loadData();
  
  const images = [];
  const files = formData.getAll('images');
  for (const file of files) {
    if (file instanceof File && file.size > 0) {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const ext = file.name.split('.').pop() || 'jpg';
      const key = `img_${generateId()}.${ext}`;
      try {
        await RESTAURANT_IMAGES.put(key, base64);
        images.push(`/api/images/${key}`);
      } catch (e) {
        console.log('Cannot save image in dev mode');
      }
    }
  }
  
  const restaurant = {
    id: generateId(),
    name,
    address,
    images,
    createdBy: username,
    comments: [],
    createdAt: new Date().toISOString()
  };
  dbData.restaurants.unshift(restaurant);
  await saveData();
  return c.json({ success: true, restaurant });
});

app.get('/api/restaurants/:id', async (c) => {
  const id = c.req.param('id');
  await loadData();
  const restaurant = dbData.restaurants.find(r => r.id === id);
  if (!restaurant) {
    return c.json({ error: '餐厅不存在' }, 404);
  }
  return c.json(restaurant);
});

app.post('/api/restaurants/:id/comments', async (c) => {
  const id = c.req.param('id');
  const formData = await c.req.formData();
  const username = formData.get('username')?.toString();
  const text = formData.get('text')?.toString() || '';
  
  const images = [];
  const files = formData.getAll('images');
  for (const file of files) {
    if (file instanceof File && file.size > 0) {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const ext = file.name.split('.').pop() || 'jpg';
      const key = `img_${generateId()}.${ext}`;
      try {
        await RESTAURANT_IMAGES.put(key, base64);
        images.push(`/api/images/${key}`);
      } catch (e) {
        console.log('Cannot save image in dev mode');
      }
    }
  }
  
  if (!text && images.length === 0) {
    return c.json({ error: '请输入评论内容或图片' }, 400);
  }
  
  await loadData();
  const restaurant = dbData.restaurants.find(r => r.id === id);
  if (!restaurant) {
    return c.json({ error: '餐厅不存在' }, 404);
  }
  
  const comment = {
    id: generateId(),
    author: username,
    text,
    images,
    time: new Date().toISOString()
  };
  restaurant.comments.unshift(comment);
  await saveData();
  return c.json({ success: true, comment });
});

app.get('/api/images/:key', async (c) => {
  const key = c.req.param('key');
  try {
    const data = await RESTAURANT_IMAGES.get(key);
    if (!data) {
      return c.json({ error: '图片不存在' }, 404);
    }
    const ext = key.split('.').pop();
    const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Response(bytes, {
      headers: { 'Content-Type': mimeType }
    });
  } catch (e) {
    return c.json({ error: '图片不存在' }, 404);
  }
});

app.get('*', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WFLAwall</title>
</head>
<body>
  <h1>WFLAwall 餐厅评分系统</h1>
  <p>正在加载...</p>
  <script>
    window.location.href = '/index.html';
  </script>
</body>
</html>
  `);
});

export default app;
