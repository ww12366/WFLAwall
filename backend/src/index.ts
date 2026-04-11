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
  
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(payload.userId).first() as any;
  
  if (!user || user.status === 'deleted') {
    return null;
  }
  
  return user;
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
    
    const token = createToken({ userId: result.meta.last_row_id, role });
    
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
    
    const token = createToken({ userId: user.id, role: user.role });
    
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
    ).bind(user.id).run();
    
    // 完全删除用户记录
    await c.env.DB.prepare(
      'DELETE FROM users WHERE id = ?'
    ).bind(user.id).run();
    
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
  const userId = c.req.param('userId');
  
  const user = await c.env.DB.prepare(
    'SELECT user_id, username, avatar, role, status, createdAt FROM users WHERE user_id = ?'
  ).bind(userId).first() as any;
  
  if (!user) {
    return c.json({ error: '用户不存在' }, 404);
  }
  
  if (user.status === 'deleted') {
    user.username = '已注销用户';
  }
  
  return c.json(user);
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
  const results = await c.env.DB.prepare(
    'SELECT r.id, r.name, r.address, r.images, r.createdBy, r.createdByUserId, r.createdAt, u.role as authorRole, u.username as authorUsername, u.avatar as authorAvatar, (SELECT COUNT(*) FROM comments WHERE restaurant_id = r.id) as commentCount, (SELECT COUNT(*) FROM likes WHERE target_id = r.id AND target_type = \'post\') as likeCount FROM restaurants r LEFT JOIN users u ON r.createdByUserId = u.user_id ORDER BY CASE WHEN u.role >= 2 THEN 0 ELSE 1 END, r.createdAt DESC'
  ).all();
  
  const restaurants = (results.results || []).map((r: any) => ({
    ...r,
    images: typeof r.images === 'string' ? JSON.parse(r.images || '[]') : r.images || []
  }));
  
  return c.json(restaurants);
});

// 创建餐厅
app.post('/api/restaurants', async (c) => {
  const user = await getCurrentUser(c);
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
  const files = formData.getAll('images');
  
  for (const file of files) {
    if (file instanceof File && file.size > 0) {
      const arrayBuffer = await file.arrayBuffer();
      const ext = file.name.split('.').pop() || 'jpg';
      const key = 'restaurant/' + generateId() + '.' + ext;
      
      await c.env.BUCKET.put(key, arrayBuffer, {
        httpMetadata: { contentType: file.type }
      });
      
      images.push(R2_PUBLIC_URL + '/' + key);
    }
  }
  
  const id = generateId();
  const imagesJson = JSON.stringify(images);
  
  await c.env.DB.prepare(
    'INSERT INTO restaurants (id, name, address, images, createdBy, createdByUserId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, name, address, imagesJson, user.username, user.user_id, new Date().toISOString()).run();
  
  return c.json({ success: true, restaurant: { id, name, address, images, createdBy: user.username, createdByUserId: user.user_id } });
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
  
  const restaurant = await c.env.DB.prepare(
    'SELECT r.*, u.role as authorRole, u.username as authorUsername, u.avatar as authorAvatar, (SELECT COUNT(*) FROM likes WHERE target_id = r.id AND target_type = \'post\') as likeCount FROM restaurants r LEFT JOIN users u ON r.createdByUserId = u.user_id WHERE r.id = ?'
  ).bind(id).first();
  
  if (!restaurant) {
    return c.json({ error: '帖子不存在' }, 404);
  }
  
  const comments = await c.env.DB.prepare(
    'SELECT c.id, c.restaurant_id, c.author, c.author_user_id, c.text, c.images, c.parent_id, c.reply_to_user_id, c.reply_to_username, c.createdAt, u.username, u.avatar, u.status, (SELECT COUNT(*) FROM likes WHERE target_id = c.id AND target_type = \'comment\') as likeCount FROM comments c LEFT JOIN users u ON c.author_user_id = u.user_id WHERE c.restaurant_id = ? ORDER BY c.createdAt ASC'
  ).bind(id).all();
  
  const commentsList = (comments.results || []).map((comment: any) => {
    const displayName = comment.status === 'deleted' ? '已注销用户' : (comment.username || comment.author);
    return {
      ...comment,
      author_username: displayName,
      author_avatar: comment.status === 'deleted' ? DEFAULT_AVATAR : comment.avatar,
      time: comment.createdAt,
      images: typeof comment.images === 'string' ? JSON.parse(comment.images || '[]') : comment.images || []
    };
  });
  
  return c.json({
    ...restaurant,
    images: typeof (restaurant as any).images === 'string' ? JSON.parse((restaurant as any).images || '[]') : (restaurant as any).images || [],
    comments: commentsList
  });
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

app.get('*', (c) => {
  return c.html('<html><body><h1>WFLAwall API</h1></body></html>');
});

export default app;
