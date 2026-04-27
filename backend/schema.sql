-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  role INTEGER DEFAULT 1 CHECK(role IN (1, 2, 3, 4)),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'banned', 'deleted')),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 餐厅表
CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  images TEXT DEFAULT '[]',
  createdBy TEXT,
  createdByUserId TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 评论表
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_user_id TEXT,
  text TEXT DEFAULT '',
  images TEXT DEFAULT '[]',
  parent_id TEXT,
  reply_to_user_id TEXT,
  reply_to_username TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 点赞表
CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, target_id, target_type)
);

-- 关注表
CREATE TABLE IF NOT EXISTS follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(follower_id, following_id)
);

-- 收藏表
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, post_id)
);

-- 观看记录表
CREATE TABLE IF NOT EXISTS views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, post_id)
);

-- 用户表
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  role INTEGER DEFAULT 1 CHECK(role IN (1, 2, 3, 4)),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'banned', 'deleted')),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 密码历史表
CREATE TABLE password_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  password TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ID分配记录表
CREATE TABLE id_allocation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  allocated_id TEXT NOT NULL,
  user_id INTEGER,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 系统设置表
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 餐厅表
CREATE TABLE restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  images TEXT DEFAULT '[]',
  createdBy TEXT,
  createdByUserId TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 评论表
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  author TEXT NOT NULL,
  author_user_id TEXT,
  text TEXT DEFAULT '',
  images TEXT DEFAULT '[]',
  parent_id TEXT,
  reply_to_user_id TEXT,
  reply_to_username TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 点赞表
CREATE TABLE likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, target_id, target_type)
);

-- 关注表
CREATE TABLE follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(follower_id, following_id)
);

-- 收藏表
CREATE TABLE favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, post_id)
);

-- 观看记录表
CREATE TABLE views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, post_id)
);
