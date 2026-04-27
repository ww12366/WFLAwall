import { Hono } from 'hono';
import { cors } from 'hono/cors';
import bcrypt from 'bcryptjs';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

const R2_PUBLIC_URL = 'https://pub-1140fcd4af894b429bcee14f4c466572.r2.dev';
const DEFAULT_AVATAR = 'https://wfla-wall.pages.dev/user.png';
const JWT_SECRET = 'wfla-wall-secret-key-2024';

app.use('*', cors({
  origin: '*',
  credentials: true,
}));

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatUserId(id: number): string {
  return id.toString().padStart(8, '0');
}

async function getNextId(db: D1Database, role: number): Promise<string> {
  let minId, maxId;
  
  if (role === 3) { // 管理员
    minId = 1;
    maxId = 99;
  } else if (role === 2) { // 高级用户
    minId = 100;
    maxId = 999;
  } else { // 普通用户
    minId = 1000;
    maxId = 99999999;
  }
  
  const result = await db.prepare(
    'SELECT CAST(user_id AS INTEGER) as num_id FROM users WHERE role = ? AND CAST(user_id AS INTEGER) BETWEEN ? AND ? ORDER BY num_id'
  ).bind(role, minId, maxId).all() as any;
  
  const usedIds = result?.results || [];
  const usedSet = new Set(usedIds.map((r: any) => r.num_id));
  
  for (let id = minId; id <= maxId; id++) {
    if (!usedSet.has(id)) {
      return formatUserId(id);
    }
  }
  
  throw new Error('ID范围已满');
}

function simpleHash(password: string): string {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

function createToken(payload: any): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadStr = btoa(JSON.stringify(payload));
  const signature = btoa(JWT_SECRET + '.' + payloadStr);
  return header + '.' + payloadStr + '.' + signature;
}

function verifyToken(token: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

async function getCurrentUser(c: any): Promise<any | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload) return null;
  
  const userId = payload.userId;
  const user_id = payload.user_id;
  const role = payload.role;
  
  if (!user_id && userId) {
    const user = await c.env.DB.prepare(
      'SELECT user_id, role, status, username FROM users WHERE id = ?'
    ).bind(userId).first() as any;
    if (user) {
      return { id: userId, user_id: user.user_id, role: user.role, status: user.status, username: user.username };
    }
    return null;
  }
  
  if (!user_id) return null;
  
  // 如果 token 中有 user_id，也需要查询获取 status 和 username
  const user = await c.env.DB.prepare(
    'SELECT role, status, username FROM users WHERE user_id = ?'
  ).bind(user_id).first() as any;
  
  return { id: userId, user_id: user_id, role: role, status: user?.status || 'active', username: user?.username || '' };
}

function checkPermission(user: any, requiredRoles: string[]): boolean {
  if (!user) return false;
  return requiredRoles.includes(user.role);
}

// 初始化最高管理员
app.post('/api/setup/create-root', async (c) => {
  try {
    const existing = await c.env.DB.prepare(
      "SELECT user_id FROM users WHERE user_id = '00000000'"
    ).first();
    
    if (existing) {
      return c.json({ error: '系统已初始化，该接口不可用' }, 400);
    }
    
    const passwordHash = simpleHash('00000000');
    
    const result = await c.env.DB.prepare(
      "INSERT INTO users (user_id, username, password, role, status, avatar) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind('00000000', '00000000', passwordHash, 4, 'active', DEFAULT_AVATAR).run();
    
    await c.env.DB.prepare(
      'INSERT INTO password_history (user_id, password) VALUES (?, ?)'
    ).bind(result.meta.last_row_id, passwordHash).run();
    
    await c.env.DB.prepare(
      "INSERT INTO system_settings (key, value) VALUES ('initialized', 'true')"
    ).run();
    
    return c.json({ success: true, message: '最高管理员创建成功', user_id: '00000000' });
  } catch (e) {
    return c.json({ error: '创建失败: ' + (e as Error).message }, 500);
  }
});

// 注册
app.post('/api/register', async (c) => {
  try {
    const { username, password } = await c.req.json();
    
    if (!username || !password) {
      return c.json({ error: '请输入用户名和密码' }, 400);
    }
    
    if (username.length < 2 || username.length > 20) {
      return c.json({ error: '用户名长度需2-20个字符' }, 400);
    }
    
    if (password.length < 6) {
      return c.json({ error: '密码长度需至少6位' }, 400);
    }
    
    const existing = await c.env.DB.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).bind(username).first();
    
    if (existing) {
      return c.json({ error: '用户名已存在' }, 400);
    }
    
    // 检查是否为第一次注册且使用00000000作为用户名和密码
    const userCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM users'
    ).first() as any;
    
    let role = 1; // 普通用户
    let userId: string;
    
    // 如果是第一个用户，且用00000000作为用户名和密码，则成为最高管理员
    if (userCount.count === 0 && username === '00000000' && password === '00000000') {
      role = 4; // 最高管理员
      userId = '00000000';
    } else {
      userId = await getNextId(c.env.DB, 1);
    }
    
    const passwordHash = simpleHash(password);
    
    const result = await c.env.DB.prepare(
      'INSERT INTO users (user_id, username, password, role, status, avatar) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(userId, username, passwordHash, role, 'active', DEFAULT_AVATAR).run();
    
    await c.env.DB.prepare(
      'INSERT INTO password_history (user_id, password) VALUES (?, ?)'
    ).bind(result.meta.last_row_id, passwordHash).run();
    
    const token = createToken({ userId: result.meta.last_row_id, user_id: userId, role });
    
    return c.json({ 
      success: true, 
      user: { user_id: userId, username, avatar: DEFAULT_AVATAR, role },
      token 
    });
  } catch (e) {
    console.error('Register error:', e);
    return c.json({ error: '注册失败: ' + (e as Error).message }, 500);
  }
});

// 登录
app.post('/api/login', async (c) => {
  try {
    const { username, password } = await c.req.json();
    
    if (!username || !password) {
      return c.json({ error: '请输入用户名和密码' }, 400);
    }
    
    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE username = ?'
    ).bind(username).first() as any;
    
    if (!user) {
      return c.json({ error: '用户名或密码错误' }, 401);
    }
    
    if (user.status === 'banned') {
      return c.json({ error: '账号已被封禁' }, 403);
    }
    
    if (user.status === 'deleted') {
      return c.json({ error: '账号已注销' }, 403);
    }
    
    if (!verifyPassword(password, user.password)) {
      return c.json({ error: '用户名或密码错误' }, 401);
    }
    
    const token = createToken({ userId: user.id, user_id: user.user_id, role: user.role });
    
    return c.json({ 
      success: true, 
      user: { 
        user_id: user.user_id, 
        username: user.username, 
        avatar: user.avatar, 
        role: user.role,
        status: user.status
      },
      token 
    });
  } catch (e) {
    console.error('Login error:', e);
    return c.json({ error: '登录失败: ' + (e as Error).message }, 500);
  }
});

// 修改用户名
app.post('/api/user/update-username', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: '请先登录' }, 401);
  }
  
  const { newUsername } = await c.req.json();
  
  if (!newUsername || newUsername.length < 2 || newUsername.length > 20) {
    return c.json({ error: '用户名长度需2-20个字符' }, 400);
  }
  
  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE username = ? AND id != ?'
  ).bind(newUsername, user.id).first();
  
  if (existing) {
    return c.json({ error: '用户名已存在' }, 400);
  }
  
  await c.env.DB.prepare(
    'UPDATE users SET username = ? WHERE id = ?'
  ).bind(newUsername, user.id).run();
  
  return c.json({ success: true });
});

// 修改密码
app.post('/api/user/update-password', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: '请先登录' }, 401);
  }
  
  const { oldPassword, newPassword } = await c.req.json();
  
  if (!oldPassword || !newPassword) {
    return c.json({ error: '请输入旧密码和新密码' }, 400);
  }
  
  if (newPassword.length < 6) {
    return c.json({ error: '新密码长度需至少6位' }, 400);
  }
  
  if (!verifyPassword(oldPassword, user.password)) {
    return c.json({ error: '旧密码错误' }, 400);
  }
  
  const history = await c.env.DB.prepare(
    'SELECT password FROM password_history WHERE user_id = ? ORDER BY createdAt DESC LIMIT 5'
  ).bind(user.id).all();
  
  for (const h of (history.results || [])) {
    if (verifyPassword(newPassword, (h as any).password)) {
      return c.json({ error: '不能重复使用最近5次使用过的密码' }, 400);
    }
  }
  
  const newHash = simpleHash(newPassword);
  
  await c.env.DB.prepare(
    'UPDATE users SET password = ? WHERE id = ?'
  ).bind(newHash, user.id).run();
  
  await c.env.DB.prepare(
    'INSERT INTO password_history (user_id, password) VALUES (?, ?)'
  ).bind(user.id, newHash).run();
  
  await c.env.DB.prepare(
    'DELETE FROM password_history WHERE user_id = ? AND id NOT IN (SELECT id FROM password_history WHERE user_id = ? ORDER BY createdAt DESC LIMIT 10)'
  ).bind(user.id, user.id).run();
  
  return c.json({ success: true });
});

// 注销账号
app.post('/api/user/delete-account', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: '请先登录' }, 401);
  }
  
  try {
    const userId = user.user_id;
    const databaseUserId = user.id;
    
    // 删除该用户发布的所有帖子
    await c.env.DB.prepare(
      'DELETE FROM restaurants WHERE createdByUserId = ?'
    ).bind(userId).run();
    
    // 删除该用户发布的所有评论
    await c.env.DB.prepare(
      'DELETE FROM comments WHERE author_user_id = ?'
    ).bind(userId).run();
    
    // 删除该用户的所有点赞
    await c.env.DB.prepare(
      'DELETE FROM likes WHERE user_id = ?'
    ).bind(userId).run();
    
    // 删除该用户的关注（作为 follower）
    await c.env.DB.prepare(
      'DELETE FROM follows WHERE follower_id = ?'
    ).bind(userId).run();
    
    // 删除该用户的粉丝（作为 following）
    await c.env.DB.prepare(
      'DELETE FROM follows WHERE following_id = ?'
    ).bind(userId).run();
    
    // 删除该用户的收藏
    await c.env.DB.prepare(
      'DELETE FROM favorites WHERE user_id = ?'
    ).bind(userId).run();
    
    // 删除该用户的浏览记录
    await c.env.DB.prepare(
      'DELETE FROM views WHERE user_id = ?'
    ).bind(userId).run();
    
    // 删除R2中的头像图片
    if (user.avatar && user.avatar.startsWith('https://pub-')) {
      try {
        const key = user.avatar.split('/').pop();
        if (key) {
          await c.env.BUCKET.delete(key);
        }
      } catch (e) {
        console.error('Delete avatar error:', e);
      }
    }
    
    // 先删除密码历史记录（外键约束）
    await c.env.DB.prepare(
      'DELETE FROM password_history WHERE user_id = ?'
    ).bind(databaseUserId).run();
    
    // 完全删除用户记录
    await c.env.DB.prepare(
      'DELETE FROM users WHERE id = ?'
    ).bind(databaseUserId).run();
    
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: '注销失败: ' + (e as Error).message }, 500);
  }
});

// 权限变更
app.post('/api/admin/change-role', async (c) => {
  const currentUser = await getCurrentUser(c);
  if (!currentUser || currentUser.role < 3) {
    return c.json({ error: '权限不足' }, 403);
  }
  
  const { targetUserId, newRole } = await c.req.json();
  
  if (!targetUserId || newRole === undefined) {
    return c.json({ error: '参数不完整' }, 400);
  }
  
  if (![1, 2, 3].includes(newRole)) {
    return c.json({ error: '无效的角色' }, 400);
  }
  
  const targetUser = await c.env.DB.prepare(
    'SELECT * FROM users WHERE user_id = ?'
  ).bind(targetUserId).first() as any;
  
  if (!targetUser) {
    return c.json({ error: '用户不存在' }, 404);
  }
  
  // 不能操作自己
  if (targetUser.id === currentUser.id) {
    return c.json({ error: '不能操作自己' }, 400);
  }
  
  // 不能操作最高管理员
  if (targetUser.role === 4) {
    return c.json({ error: '不能操作最高管理员' }, 400);
  }
  
  // 不能操作比自己权限高的用户
  if (targetUser.role >= currentUser.role) {
    return c.json({ error: '不能操作权限高于自己的用户' }, 403);
  }
  
  // 最高管理员不能被创建
  if (newRole === 4) {
    return c.json({ error: '不能创建最高管理员' }, 400);
  }
  
  // 管理员(3)只能操作普通用户(1)和高级用户(2)
  if (currentUser.role === 3 && newRole === 3) {
    return c.json({ error: '权限不足' }, 403);
  }
  
  try {
    const oldUserId = targetUser.user_id;
    const newUserId = await getNextId(c.env.DB, newRole);
    const tempUsername = 'temp_' + Date.now() + '_' + targetUser.id;
    
    // 先将旧用户的用户名改为临时值（释放用户名约束）
    await c.env.DB.prepare(
      'UPDATE users SET username = ? WHERE id = ?'
    ).bind(tempUsername, targetUser.id).run();
    
    // 创建新用户记录，复制所有信息但使用新ID
    await c.env.DB.prepare(
      'INSERT INTO users (user_id, username, password, email, avatar, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(newUserId, targetUser.username, targetUser.password, targetUser.email, targetUser.avatar, newRole, targetUser.status).run();
    
    // 更新该用户发布的所有帖子的作者ID
    await c.env.DB.prepare(
      'UPDATE restaurants SET createdByUserId = ? WHERE createdByUserId = ?'
    ).bind(newUserId, oldUserId).run();
    
    // 更新该用户发布的所有评论的作者ID
    await c.env.DB.prepare(
      'UPDATE comments SET author_user_id = ? WHERE author_user_id = ?'
    ).bind(newUserId, oldUserId).run();
    
    // 删除旧用户的密码历史记录
    await c.env.DB.prepare(
      'DELETE FROM password_history WHERE user_id = ?'
    ).bind(targetUser.id).run();
    
    // 删除旧用户记录（释放旧ID）
    await c.env.DB.prepare(
      'DELETE FROM users WHERE id = ?'
    ).bind(targetUser.id).run();
    
    return c.json({ success: true, user_id: newUserId, username: targetUser.username });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// 封禁/解封用户
app.post('/api/admin/ban-user', async (c) => {
  const currentUser = await getCurrentUser(c);
  if (!currentUser || currentUser.role < 3) {
    return c.json({ error: '权限不足' }, 403);
  }
  
  const { targetUserId, banned } = await c.req.json();
  
  const targetUser = await c.env.DB.prepare(
    'SELECT * FROM users WHERE user_id = ?'
  ).bind(targetUserId).first() as any;
  
  if (!targetUser) {
    return c.json({ error: '用户不存在' }, 404);
  }
  
  // 不能操作最高管理员
  if (targetUser.role === 4) {
    return c.json({ error: '不能操作最高管理员' }, 400);
  }
  
  // 不能操作比自己权限高的用户
  if (targetUser.role >= currentUser.role) {
    return c.json({ error: '不能操作权限高于自己的用户' }, 403);
  }
  
  await c.env.DB.prepare(
    'UPDATE users SET status = ? WHERE id = ?'
  ).bind(banned ? 'banned' : 'active', targetUser.id).run();
  
  return c.json({ success: true });
});

// 获取用户信息
app.get('/api/user/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    console.log('Fetching user:', userId);
    
    const user = await c.env.DB.prepare(
      'SELECT user_id, username, avatar, role, status, createdAt FROM users WHERE user_id = ?'
    ).bind(userId).first() as any;
    
    console.log('User result:', user);
    
    if (!user) {
      return c.json({ error: '用户不存在' }, 404);
    }
    
    if (user.status === 'deleted') {
      user.username = '已注销用户';
    }
    
    return c.json(user);
  } catch (e: any) {
    console.error('Error fetching user:', e);
    return c.json({ error: e.message || '服务器错误' }, 500);
  }
});

// 获取当前用户信息
app.get('/api/me', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: '未登录' }, 401);
  }
  
  return c.json({
    user_id: user.user_id,
    username: user.username,
    avatar: user.avatar,
    role: user.role,
    status: user.status
  });
});

// 更新头像
app.post('/api/user/update-avatar', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: '请先登录' }, 401);
  }
  
  const formData = await c.req.formData();
  const avatarFile = formData.get('avatar') as File;
  
  if (!avatarFile) {
    return c.json({ error: '请选择头像文件' }, 400);
  }
  
  const arrayBuffer = await avatarFile.arrayBuffer();
  const ext = avatarFile.name.split('.').pop() || 'png';
  const key = 'avatar/' + user.user_id + '.' + ext;
  
  await c.env.BUCKET.put(key, arrayBuffer, {
    httpMetadata: { contentType: avatarFile.type }
  });
  
  const avatarUrl = R2_PUBLIC_URL + '/' + key;
  
  await c.env.DB.prepare(
    'UPDATE users SET avatar = ? WHERE id = ?'
  ).bind(avatarUrl, user.id).run();
  
  return c.json({ success: true, avatar: avatarUrl });
});

// 获取餐厅列表
app.get('/api/restaurants', async (c) => {
  try {
    console.log('=== loading restaurants ===');
    const results = await c.env.DB.prepare(
      'SELECT id, name, address, images, createdBy, createdByUserId, createdAt FROM restaurants ORDER BY createdAt DESC LIMIT 50'
    ).all();
    console.log('results:', results);
    const list = (results.results || []).map((r: any) => {
      const images = typeof r.images === 'string' ? JSON.parse(r.images || '[]') : r.images || [];
      return { ...r, commentCount: 0, likeCount: 0, viewCount: 0, images };
    });
    console.log('list length:', list.length);
    return c.json(list);
  } catch (e) {
    console.error('Error loading restaurants:', e);
    return c.json({ error: (e as Error).message }, 500);
  }
});

// 创建餐厅
app.post('/api/restaurants', async (c) => {
  try {
    console.log('=== creating restaurant ===');
    const user = await getCurrentUser(c);
    console.log('user:', user);
    if (!user) {
      return c.json({ error: '请先登录' }, 401);
    }
    
    if (user.status === 'banned') {
      return c.json({ error: '账号已被封禁' }, 403);
    }
    
    const formData = await c.req.formData();
    const name = formData.get('name')?.toString();
    const address = formData.get('address')?.toString();
    
    if (!name || !address) {
      return c.json({ error: '请填写标题和正文' }, 400);
    }
    
    const images: string[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === 'images' || key.startsWith('image_')) {
        const file = value as File;
        if (file.size > 0) {
          const arrayBuffer = await file.arrayBuffer();
          const key2 = generateId();
          await c.env.BUCKET.put(key2, arrayBuffer, {
            httpMetadata: { contentType: file.type }
          });
          images.push(R2_PUBLIC_URL + '/' + key2);
        }
      }
    }
    
    const id = generateId();
    const imagesJson = JSON.stringify(images);
    console.log('inserting restaurant:', { id, name, address, imagesJson, username: user.username, user_id: user.user_id });
    
    await c.env.DB.prepare(
      'INSERT INTO restaurants (id, name, address, images, createdBy, createdByUserId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, name, address, imagesJson, user.username, user.user_id, new Date().toISOString()).run();
    
    console.log('restaurant created successfully');
    return c.json({ success: true, restaurant: { id, name, address, images, createdBy: user.username, createdByUserId: user.user_id } });
  } catch (e: any) {
    console.error('Error creating restaurant:', e);
    return c.json({ error: e.message }, 500);
  }
});

// 获取用户发布的餐厅
app.get('/api/user/:userId/restaurants', async (c) => {
  const userId = c.req.param('userId');
  
  const results = await c.env.DB.prepare(
    'SELECT r.id, r.name, r.address, r.images, r.createdBy, r.createdByUserId, r.createdAt, (SELECT COUNT(*) FROM comments WHERE restaurant_id = r.id) as commentCount FROM restaurants r WHERE r.createdByUserId = ? ORDER BY r.createdAt DESC'
  ).bind(userId).all();
  
  const restaurants = (results.results || []).map((r: any) => ({
    ...r,
    images: typeof r.images === 'string' ? JSON.parse(r.images || '[]') : r.images || []
  }));
  
  return c.json(restaurants);
});

// 删除餐厅
app.delete('/api/restaurants/:id', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: '请先登录' }, 401);
  }
  
  const id = c.req.param('id');
  
  const restaurant = await c.env.DB.prepare(
    'SELECT r.*, u.role as authorRole FROM restaurants r LEFT JOIN users u ON r.createdByUserId = u.user_id WHERE r.id = ?'
  ).bind(id).first() as any;
  
  if (!restaurant) {
    return c.json({ error: '帖子不存在' }, 404);
  }
  
  const authorRole = restaurant.authorRole || 1;
  
  // 只能删除自己的帖子或权限高于作者的帖子
  if (restaurant.createdByUserId !== user.user_id && user.role <= authorRole) {
    return c.json({ error: '权限不足' }, 403);
  }
  
  await c.env.DB.prepare('DELETE FROM comments WHERE restaurant_id = ?').bind(id).run();
  
  await c.env.DB.prepare('DELETE FROM restaurants WHERE id = ?').bind(id).run();
  
  return c.json({ success: true });
});

// 获取餐厅详情
app.get('/api/restaurants/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const restaurant = await c.env.DB.prepare(
      'SELECT r.*, u.role as authorRole, u.username as authorUsername, u.avatar as authorAvatar FROM restaurants r LEFT JOIN users u ON r.createdByUserId = u.user_id WHERE r.id = ?'
    ).bind(id).first();
    if (!restaurant) {
      return c.json({ error: '帖子不存在' }, 404);
    }
    const comments = await c.env.DB.prepare(
      'SELECT c.*, u.username, u.avatar, u.status FROM comments c LEFT JOIN users u ON c.author_user_id = u.user_id WHERE c.restaurant_id = ? ORDER BY c.createdAt ASC'
    ).bind(id).all();
    const commentsList = (comments.results || []).map((comment: any) => ({
      ...comment,
      author_username: comment.status === 'deleted' ? '已注销用户' : (comment.username || comment.author),
      author_avatar: comment.status === 'deleted' ? DEFAULT_AVATAR : comment.avatar,
      images: typeof comment.images === 'string' ? JSON.parse(comment.images || '[]') : comment.images || []
    }));
    const images = typeof restaurant.images === 'string' ? JSON.parse(restaurant.images || '[]') : restaurant.images || [];
    return c.json({ ...restaurant, images, comments: commentsList, viewCount: 0 });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// 添加评论
app.post('/api/restaurants/:id/comments', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: '请先登录' }, 401);
  }
  
  if (user.status === 'banned') {
    return c.json({ error: '账号已被封禁' }, 403);
  }
  
  const restaurantId = c.req.param('id');
  const formData = await c.req.formData();
  const text = formData.get('text')?.toString() || '';
  const parentId = formData.get('parent_id')?.toString() || null;
  const replyToUserId = formData.get('reply_to_user_id')?.toString() || null;
  const replyToUsername = formData.get('reply_to_username')?.toString() || null;
  
  const images: string[] = [];
  const files = formData.getAll('images');
  
  for (const file of files) {
    if (file instanceof File && file.size > 0) {
      const arrayBuffer = await file.arrayBuffer();
      const ext = file.name.split('.').pop() || 'jpg';
      const key = 'comment/' + generateId() + '.' + ext;
      
      await c.env.BUCKET.put(key, arrayBuffer, {
        httpMetadata: { contentType: file.type }
      });
      
      images.push(R2_PUBLIC_URL + '/' + key);
    }
  }
  
  if (!text && images.length === 0) {
    return c.json({ error: '请输入评论内容或图片' }, 400);
  }
  
  const restaurant = await c.env.DB.prepare(
    'SELECT id FROM restaurants WHERE id = ?'
  ).bind(restaurantId).first();
  
  if (!restaurant) {
    return c.json({ error: '帖子不存在' }, 404);
  }
  
  const id = generateId();
  const imagesJson = JSON.stringify(images);
  
  await c.env.DB.prepare(
    'INSERT INTO comments (id, restaurant_id, author, author_user_id, text, images, parent_id, reply_to_user_id, reply_to_username, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, restaurantId, user.username, user.user_id, text, imagesJson, parentId, replyToUserId, replyToUsername, new Date().toISOString()).run();
  
  return c.json({ success: true, comment: { id, author: user.username, author_user_id: user.user_id, text, images, parent_id: parentId, reply_to_user_id: replyToUserId, reply_to_username: replyToUsername } });
});

// 删除评论
app.delete('/api/comments/:id', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: '请先登录' }, 401);
  }
  
  const commentId = c.req.param('id');
  
  const comment = await c.env.DB.prepare(
    'SELECT * FROM comments WHERE id = ?'
  ).bind(commentId).first() as any;
  
  if (!comment) {
    return c.json({ error: '评论不存在' }, 404);
  }
  
  // 检查权限：作者本人 或 管理员(role>=3)
  const isAuthor = comment.author_user_id === user.user_id;
  const isAdmin = user.role >= 3;
  
  if (!isAuthor && !isAdmin) {
    return c.json({ error: '权限不足' }, 403);
  }
  
  // 管理员不能删除最高管理员的评论
  if (isAdmin && !isAuthor) {
    const authorUser = await c.env.DB.prepare(
      'SELECT role FROM users WHERE user_id = ?'
    ).bind(comment.author_user_id).first() as any;
    
    if (authorUser && authorUser.role === 4) {
      return c.json({ error: '不能删除最高管理员的评论' }, 403);
    }
  }
  
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run();
  
  return c.json({ success: true });
});

// 点赞/取消点赞
app.post('/api/like', async (c) => {
  const user = await getCurrentUser(c);
  if (!user) {
    return c.json({ error: '请先登录' }, 401);
  }
  
  if (user.status === 'banned') {
    return c.json({ error: '账号已被封禁' }, 403);
  }
  
  const { target_id, target_type } = await c.req.json();
  
  if (!target_id || !target_type) {
    return c.json({ error: '参数不完整' }, 400);
  }
  
  if (!['post', 'comment'].includes(target_type)) {
    return c.json({ error: '无效的点赞类型' }, 400);
  }
  
  // 检查目标是否存在
  if (target_type === 'post') {
    const post = await c.env.DB.prepare('SELECT id FROM restaurants WHERE id = ?').bind(target_id).first();
    if (!post) {
      return c.json({ error: '帖子不存在' }, 404);
    }
  } else {
    const comment = await c.env.DB.prepare('SELECT id FROM comments WHERE id = ?').bind(target_id).first();
    if (!comment) {
      return c.json({ error: '评论不存在' }, 404);
    }
  }
  
  // 检查是否已点赞
  const existingLike = await c.env.DB.prepare(
    'SELECT id FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?'
  ).bind(user.user_id, target_id, target_type).first();
  
  if (existingLike) {
    // 取消点赞
    await c.env.DB.prepare(
      'DELETE FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?'
    ).bind(user.user_id, target_id, target_type).run();
    
    return c.json({ success: true, liked: false });
  } else {
    // 添加点赞
    await c.env.DB.prepare(
      'INSERT INTO likes (user_id, target_id, target_type) VALUES (?, ?, ?)'
    ).bind(user.user_id, target_id, target_type).run();
    
    return c.json({ success: true, liked: true });
  }
});

// 获取点赞状态和数量
app.get('/api/likes/:target_type/:target_id', async (c) => {
  const targetType = c.req.param('target_type');
  const targetId = c.req.param('target_id');
  
  if (!['post', 'comment'].includes(targetType)) {
    return c.json({ error: '无效的点赞类型' }, 400);
  }
  
  // 获取点赞数
  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM likes WHERE target_id = ? AND target_type = ?'
  ).bind(targetId, targetType).first() as any;
  
  const likeCount = countResult?.count || 0;
  
  // 检查当前用户是否点赞
  let userLiked = false;
  const user = await getCurrentUser(c);
  if (user) {
    const userLike = await c.env.DB.prepare(
      'SELECT id FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?'
    ).bind(user.user_id, targetId, targetType).first();
    userLiked = !!userLike;
  }
  
  return c.json({ likeCount, userLiked });
});

// 批量获取帖子点赞状态
app.get('/api/likes/batch', async (c) => {
  const ids = c.req.param('ids') || c.req.query('ids') || '';
  if (!ids) return c.json({});
  const idList = ids.split(',').filter(Boolean);
  const user = await getCurrentUser(c);
  const result: Record<string, { count: number; liked: boolean }> = {};
  for (const id of idList) {
    const countRes = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM likes WHERE target_id = ? AND target_type = ?'
    ).bind(id, 'post').first() as any;
    let liked = false;
    if (user) {
      const likedRes = await c.env.DB.prepare(
        'SELECT id FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?'
      ).bind(user.user_id, id, 'post').first();
      liked = !!likedRes;
    }
    result[id] = { count: countRes?.count || 0, liked };
  }
  return c.json(result);
});

// 获取图片
app.get('/api/images/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.BUCKET.get(key);
  
  if (!object) {
    return c.json({ error: '图片不存在' }, 404);
  }
  
  return new Response(object.body, {
    headers: { 'Content-Type': object.httpMetadata?.contentType || 'image/jpeg' }
  });
});

// 搜索帖子
function findLongestConsecutive(str: string, query: string): number {
  const lowerStr = str.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let maxLen = 0;
  
  for (let i = 0; i <= lowerStr.length - lowerQuery.length; i++) {
    let j = 0;
    while (j < lowerQuery.length && lowerStr[i + j] === lowerQuery[j]) {
      j++;
    }
    if (j > maxLen) maxLen = j;
  }
  
  return maxLen;
}

app.get('/api/search/posts', async (c) => {
  const query = c.req.query('q') || '';
  if (!query) {
    return c.json([]);
  }
  
  const results = await c.env.DB.prepare(
    'SELECT r.id, r.name, r.address, r.images, r.createdBy, r.createdByUserId, r.createdAt, (SELECT COUNT(*) FROM comments WHERE restaurant_id = r.id) as commentCount FROM restaurants r ORDER BY r.createdAt DESC'
  ).all();
  
  const restaurants = (results.results || []).map((r: any) => ({
    ...r,
    images: typeof r.images === 'string' ? JSON.parse(r.images || '[]') : r.images || []
  }));
  
  const scored = restaurants.map(r => {
    const titleLen = findLongestConsecutive(r.name, query);
    const contentLen = findLongestConsecutive(r.address, query);
    const inTitle = titleLen > 0;
    const inContent = contentLen > 0;
    const score = inTitle ? (titleLen * 100 + contentLen) : (inContent ? contentLen : 0);
    return { ...r, titleMatchLen: titleLen, contentMatchLen: contentLen, score };
  });
  
  const filtered = scored.filter(r => r.score > 0);
  
  filtered.sort((a: any, b: any) => {
    if (a.titleMatchLen > 0 && b.titleMatchLen === 0) return -1;
    if (b.titleMatchLen > 0 && a.titleMatchLen === 0) return 1;
    if (a.titleMatchLen > 0 && b.titleMatchLen > 0) {
      return b.score - a.score;
    }
    return b.score - a.score;
  });
  
  return c.json(filtered);
});

// 搜索用户
app.get('/api/search/users', async (c) => {
  const query = c.req.query('q') || '';
  if (!query) {
    return c.json([]);
  }
  
  const results = await c.env.DB.prepare(
    'SELECT user_id, username, avatar, role, status FROM users WHERE status != ?'
  ).bind('deleted').all();
  
  const users = (results.results || []).map((u: any) => ({
    ...u,
    idExactMatch: u.user_id === query,
    usernameMatchLen: findLongestConsecutive(u.username, query)
  }));
  
  const filtered = users.filter(u => u.user_id === query || u.usernameMatchLen > 0);
  
  filtered.sort((a: any, b: any) => {
    if (a.idExactMatch && !b.idExactMatch) return -1;
    if (!a.idExactMatch && b.idExactMatch) return 1;
    return b.usernameMatchLen - a.usernameMatchLen;
  });
  
  return c.json(filtered);
});

// ========== 关注系统 ==========

// 关注用户
app.post('/api/users/:userId/follow', async (c) => {
  const currentUser = await getCurrentUser(c);
  if (!currentUser) {
    return c.json({ error: '请先登录' }, 401);
  }
  if (currentUser.status === 'banned') {
    return c.json({ error: '账号已被封禁' }, 403);
  }
  const targetUserId = c.req.param('userId');
  if (currentUser.user_id === targetUserId) {
    return c.json({ error: '不能关注自己' }, 400);
  }
  const target = await c.env.DB.prepare(
    'SELECT id FROM users WHERE user_id = ?'
  ).bind(targetUserId).first();
  if (!target) {
    return c.json({ error: '用户不存在' }, 404);
  }
  try {
    await c.env.DB.prepare(
      'INSERT INTO follows (follower_id, following_id, createdAt) VALUES (?, ?, ?)'
    ).bind(currentUser.user_id, targetUserId, new Date().toISOString()).run();
    return c.json({ success: true });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ error: '已经关注了' }, 400);
    }
    return c.json({ error: e.message }, 500);
  }
});

// 取消关注
app.delete('/api/users/:userId/follow', async (c) => {
  const currentUser = await getCurrentUser(c);
  if (!currentUser) {
    return c.json({ error: '请先登录' }, 401);
  }
  const targetUserId = c.req.param('userId');
  await c.env.DB.prepare(
    'DELETE FROM follows WHERE follower_id = ? AND following_id = ?'
  ).bind(currentUser.user_id, targetUserId).run();
  return c.json({ success: true });
});

// 获取粉丝数
app.get('/api/users/:userId/followers-count', async (c) => {
  const userId = c.req.param('userId');
  const result = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM follows WHERE following_id = ?'
  ).bind(userId).first() as any;
  return c.json({ count: result?.count || 0 });
});

// 获取收藏数
app.get('/api/users/:userId/favorites-count', async (c) => {
  const userId = c.req.param('userId');
  const result = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM favorites WHERE user_id = ?'
  ).bind(userId).first() as any;
  return c.json({ count: result?.count || 0 });
});

// 获取关注数
app.get('/api/users/:userId/following-count', async (c) => {
  const userId = c.req.param('userId');
  try {
    const result = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM follows WHERE follower_id = ?'
    ).bind(userId).first() as any;
    return c.json({ count: result?.count || 0 });
  } catch (e: any) {
    console.error('following-count error:', e);
    return c.json({ count: 0 });
  }
});

// 获取关注列表 (返回用户关注的列表)
app.get('/api/users/:userId/following-list', async (c) => {
  const userId = c.req.param('userId');
  try {
    const results = await c.env.DB.prepare(
      'SELECT u.user_id, u.username, u.avatar, f.createdAt FROM follows f JOIN users u ON f.following_id = u.user_id WHERE f.follower_id = ? AND u.status != ? ORDER BY f.createdAt DESC'
    ).bind(userId, 'deleted').all();
    return c.json(results.results || []);
  } catch (e: any) {
    console.error('following-list error:', e);
    return c.json({ error: e.message }, 500);
  }
});

// 获取粉丝列表
app.get('/api/users/:userId/followers', async (c) => {
  const userId = c.req.param('userId');
  const results = await c.env.DB.prepare(
    'SELECT u.user_id, u.username, u.avatar, f.createdAt FROM follows f JOIN users u ON f.follower_id = u.user_id WHERE f.following_id = ? AND u.status != ? ORDER BY f.createdAt DESC'
  ).bind(userId, 'deleted').all();
  return c.json(results.results || []);
});

// 调试 API - 获取 follows 表数据
app.get('/api/debug/follows', async (c) => {
  const follows = await c.env.DB.prepare('SELECT * FROM follows').all();
  return c.json({ results: follows.results, count: follows.results?.length || 0 });
});

// 检查是否已关注
app.get('/api/users/:userId/is-following', async (c) => {
  const currentUser = await getCurrentUser(c);
  const targetUserId = c.req.param('userId');
  
  if (!currentUser) {
    return c.json({ following: false, error: 'not logged in' });
  }
  
  const result = await c.env.DB.prepare(
    'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?'
  ).bind(currentUser.user_id, targetUserId).all();
  
  const following = !!(result.results && result.results.length > 0);
  return c.json({ following });
});

// ========== 收藏系统 ==========

// 收藏帖子
app.post('/api/posts/:postId/favorite', async (c) => {
  const currentUser = await getCurrentUser(c);
  if (!currentUser) {
    return c.json({ error: '请先登录' }, 401);
  }
  if (currentUser.status === 'banned') {
    return c.json({ error: '账号已被封禁' }, 403);
  }
  const postId = c.req.param('postId');
  const post = await c.env.DB.prepare(
    'SELECT id FROM restaurants WHERE id = ?'
  ).bind(postId).first();
  if (!post) {
    return c.json({ error: '帖子不存在' }, 404);
  }
  try {
    await c.env.DB.prepare(
      'INSERT INTO favorites (user_id, post_id, createdAt) VALUES (?, ?, ?)'
    ).bind(currentUser.user_id, postId, new Date().toISOString()).run();
    return c.json({ success: true });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ error: '已经收藏了' }, 400);
    }
    throw e;
  }
});

// 取消收藏
app.delete('/api/posts/:postId/favorite', async (c) => {
  const currentUser = await getCurrentUser(c);
  if (!currentUser) {
    return c.json({ error: '请先登录' }, 401);
  }
  const postId = c.req.param('postId');
  await c.env.DB.prepare(
    'DELETE FROM favorites WHERE user_id = ? AND post_id = ?'
  ).bind(currentUser.user_id, postId).run();
  return c.json({ success: true });
});

// 获取用户收藏列表
app.get('/api/users/:userId/favorites', async (c) => {
  const userId = c.req.param('userId');
  const results = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.address, r.images, r.createdByUserId, r.createdAt, r.createdBy,
     (SELECT COUNT(*) FROM comments WHERE restaurant_id = r.id) as commentCount,
     (SELECT COUNT(*) FROM likes WHERE target_id = r.id AND target_type = 'post') as likeCount,
     f.createdAt as favoritedAt
     FROM favorites f 
     JOIN restaurants r ON f.post_id = r.id 
     WHERE f.user_id = ? 
     ORDER BY f.createdAt DESC`
  ).bind(userId).all();
  const list = (results.results || []).map((r: any) => ({
    ...r,
    images: typeof r.images === 'string' ? JSON.parse(r.images || '[]') : r.images || []
  }));
  return c.json(list);
});

// 检查是否已收藏
app.get('/api/posts/:postId/favorited', async (c) => {
  const currentUser = await getCurrentUser(c);
  const postId = c.req.param('postId');
  if (!currentUser) {
    return c.json({ favorited: false });
  }
  const result = await c.env.DB.prepare(
    'SELECT id FROM favorites WHERE user_id = ? AND post_id = ?'
  ).bind(currentUser.user_id, postId).first();
  return c.json({ favorited: !!result });
});

// ========== 观看系统 ==========

// 标记观看
app.post('/api/posts/:postId/view', async (c) => {
  try {
    const currentUser = await getCurrentUser(c);
    const postId = c.req.param('postId');
    console.log('=== VIEW POST ===');
    console.log('currentUser:', currentUser?.user_id);
    console.log('postId:', postId);
    
    // 检查帖子是否存在
    const post = await c.env.DB.prepare(
      'SELECT createdByUserId FROM restaurants WHERE id = ?'
    ).bind(postId).first() as any;
    console.log('post author:', post?.createdByUserId);
    
    if (!post) {
      return c.json({ error: '帖子不存在' }, 404);
    }
    
    // 如果未登录，不计数
    if (!currentUser) {
      console.log('User not logged in');
      return c.json({ success: true, message: '未登录' });
    }
    
    // 检查是否是作者自己
    if (post.createdByUserId === currentUser.user_id) {
      console.log('User is author, not counting');
      return c.json({ success: true, message: '作者本人' });
    }
    
    // 记录观看
    console.log('Recording view for user:', currentUser.user_id);
    await c.env.DB.prepare(
      'INSERT INTO views (user_id, post_id, createdAt) VALUES (?, ?, ?)'
    ).bind(currentUser.user_id, postId, new Date().toISOString()).run();
    
    console.log('View recorded successfully');
    return c.json({ success: true, message: '已记录观看' });
  } catch (e: any) {
    console.log('View error:', e.message);
    return c.json({ success: true, message: '重复观看或错误: ' + e.message });
  }
});

// 获取观看数
app.get('/api/posts/:postId/views-count', async (c) => {
  try {
    const postId = c.req.param('postId');
    const result = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM views WHERE post_id = ?'
    ).bind(postId).first() as any;
    console.log('views-count for', postId, ':', result?.count || 0);
    return c.json({ count: result?.count || 0 });
  } catch (e: any) {
    console.error('views-count error:', e);
    return c.json({ count: 0 });
  }
});

// 获取关注者帖子
app.get('/api/following-posts', async (c) => {
  try {
    const currentUser = await getCurrentUser(c);
    if (!currentUser) {
      return c.json({ error: '请先登录' }, 401);
    }
    const userId = currentUser.user_id;
    
    const follows = await c.env.DB.prepare(
      'SELECT following_id FROM follows WHERE follower_id = ?'
    ).bind(userId).all() as any;
    
    // D1 返回格式处理
    const followResults = follows?.results || [];
    if (followResults.length === 0) {
      return c.json([]);
    }
    
    const followingIds = followResults.map((f: any) => f.following_id);
    
    const posts = await c.env.DB.prepare(
      `SELECT * FROM restaurants WHERE createdByUserId IN (${followingIds.map(() => '?').join(',')}) ORDER BY createdAt DESC LIMIT 50`
    ).bind(...followingIds).all() as any;
    
    return c.json(posts?.results || []);
    
  } catch (e: any) {
    console.error('Error in following-posts:', e);
    return c.json({ error: e.message }, 500);
  }
});

app.get('*', (c) => {
  return c.html('<html><body><h1>WFLAwall API</h1></body></html>');
});

export default app;
