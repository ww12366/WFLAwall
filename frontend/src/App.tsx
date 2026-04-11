import { useState, useEffect, useRef } from 'react'
import './App.css'

import { 
  Box, Button, TextField, Card, CardContent, CardMedia, Typography, 
  AppBar, Toolbar, Avatar, IconButton, InputAdornment,
  Dialog, DialogContent, DialogActions, Alert, Fab,
  Container, Paper, Grid, Skeleton, CircularProgress
} from '@mui/material'
import { 
  Search as SearchIcon, Add as AddIcon, 
  ArrowBack as ArrowBackIcon,
  FavoriteBorder, Favorite,
  PhotoCamera, Close as CloseIcon, Image as ImageIcon,
  MoreVert as MoreVertIcon
} from '@mui/icons-material'

const API_BASE = 'https://wfla-backend.r61105507.workers.dev/api'

interface User {
  id?: number
  user_id: string
  username: string
  avatar: string
  role: number
  status?: string
}

interface Restaurant {
  id: string
  name: string
  address: string
  images: string[]
  createdBy: string
  createdByUserId: string
  commentCount: number
  createdAt: string
  authorUsername?: string
  authorAvatar?: string
  authorRole?: number
  likeCount?: number
}

interface RestaurantDetail extends Restaurant {
  comments: Comment[]
}

interface Comment {
  id: string
  author: string
  author_user_id: string
  author_username?: string
  author_avatar?: string
  text: string
  images: string[]
  time: string
  parent_id?: string
  reply_to_user_id?: string
  reply_to_username?: string
  likeCount?: number
}

function App() {
  const [page, setPage] = useState<'auth' | 'main' | 'create' | 'detail' | 'profile' | 'otherProfile'>('auth')
  const [user, setUser] = useState<User | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [currentRestaurant, setCurrentRestaurant] = useState<RestaurantDetail | null>(null)
  const [userRestaurants, setUserRestaurants] = useState<Restaurant[]>([])
  const [otherUser, setOtherUser] = useState<User | null>(null)
  const [otherUserRestaurants, setOtherUserRestaurants] = useState<Restaurant[]>([])
  const [viewFromDetail, setViewFromDetail] = useState(false)
  
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLogin, setIsLogin] = useState(true)
  
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [selectedImages, setSelectedImages] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  
  const [commentText, setCommentText] = useState('')
  const [commentImages, setCommentImages] = useState<File[]>([])
  const [commentPreviews, setCommentPreviews] = useState<string[]>([])
  const [replyTo, setReplyTo] = useState<{ id: string; username: string; user_id: string } | null>(null)
  const [showCommentMenu, setShowCommentMenu] = useState<string | null>(null)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  
  const [editingUsername, setEditingUsername] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [isLoadingInitial, setIsLoadingInitial] = useState(false)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Restaurant[]>([])
  const [searchUsers, setSearchUsers] = useState<User[]>([])
  const [searchType, setSearchType] = useState<'posts' | 'users'>('posts')
  const [isSearching, setIsSearching] = useState(false)

  const [postLikes, setPostLikes] = useState<Record<string, { count: number; liked: boolean }>>({})
  const [commentLikes, setCommentLikes] = useState<Record<string, { count: number; liked: boolean }>>({})

  useEffect(() => {
    const savedUser = localStorage.getItem('user')
    if (savedUser) {
      const parsed = JSON.parse(savedUser)
      parsed.role = Number(parsed.role)
      setUser(parsed)
      setPage('main')
    }
  }, [])

  useEffect(() => {
    if (user) {
      loadRestaurants()
    }
  }, [user])

  async function loadRestaurants() {
    const currentUser = user
    setIsLoadingInitial(true)
    try {
      const res = await fetch(`${API_BASE}/restaurants`)
      if (!res.ok) { setIsLoadingInitial(false); return }
      const data = await res.json()
      setRestaurants(data || [])
      
      if (currentUser && data.length > 0) {
        const headers = getAuthHeaders()
        const likesData: Record<string, { count: number; liked: boolean }> = {}
        
        for (const r of data) {
          try {
            const likeRes = await fetch(`${API_BASE}/likes/post/${r.id}`, { headers })
            const likeData = await likeRes.json()
            likesData[r.id] = { count: likeData.likeCount || 0, liked: likeData.userLiked || false }
          } catch {
            likesData[r.id] = { count: r.likeCount || 0, liked: false }
          }
        }
        setPostLikes(likesData)
      }
    } catch (e) {
      console.error('Failed to load restaurants:', e)
    }
    setIsLoadingInitial(false)
  }

  async function loadUserRestaurants() {
    if (!user) return
    try {
      const res = await fetch(`${API_BASE}/user/${user.user_id}/restaurants`)
      const data = await res.json()
      setUserRestaurants(data || [])
    } catch (e) {
      console.error('Failed to load user restaurants:', e)
    }
  }

  function getAuthHeaders(): HeadersInit {
    const token = localStorage.getItem('token')
    if (token) {
      return { 'Authorization': `Bearer ${token}` }
    }
    return {}
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim()) {
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    setPage('main')
    
    try {
      if (searchType === 'posts') {
        await searchPosts(searchQuery)
      } else {
        await performUserSearch(searchQuery)
      }
    } catch (e) {
      console.error('Search failed:', e)
      setIsSearching(false)
    }
  }

  async function searchPosts(query: string) {
    setIsSearching(true)
    const res = await fetch(`${API_BASE}/search/posts?q=${encodeURIComponent(query)}`)
    const data = await res.json()
    setSearchResults(data || [])
    setIsSearching(false)
  }

  async function performUserSearch(query: string) {
    setIsSearching(true)
    const res = await fetch(`${API_BASE}/search/users?q=${encodeURIComponent(query)}`)
    const data = await res.json()
    setSearchUsers(data || [])
    setIsSearching(false)
  }

  function clearSearch() {
    setSearchQuery('')
    setSearchResults([])
    setSearchUsers([])
    setIsSearching(false)
  }

  useEffect(() => {
    if (page === 'profile' && user) {
      loadUserRestaurants()
    }
  }, [page, user])

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    
    if (!username || !password) {
      setError('请输入用户名和密码')
      setLoading(false)
      return
    }
    
    const endpoint = isLogin ? '/login' : '/register'
    const url = `${API_BASE}${endpoint}`
    console.log('Request URL:', url)
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      
      console.log('Response status:', res.status)
      
      const data = await res.json()
      console.log('Response data:', data)
      
      if (data.error) {
        setError(data.error)
        setLoading(false)
        return
      }
      
      if (data.success) {
        setError('')
        setUser(data.user)
        localStorage.setItem('user', JSON.stringify(data.user))
        if (data.token) {
          localStorage.setItem('token', data.token)
        }
        setPage('main')
        loadRestaurants()
        setSearchQuery('')
        setSearchResults([])
        setSearchUsers([])
        setCurrentRestaurant(null)
        setOtherUser(null)
        setPostLikes({})
        setCommentLikes({})
      }
    } catch (e: any) {
      console.error('Fetch error:', e)
      if (e.name === 'AbortError') {
        setError('请求超时，请稍后重试')
      } else {
        setError('网络错误: ' + (e.message || '未知错误'))
      }
    }
    setLoading(false)
  }

  function logout() {
    setUser(null)
    localStorage.removeItem('user')
    localStorage.removeItem('token')
    setPage('auth')
    setRestaurants([])
    setSearchQuery('')
    setSearchResults([])
    setSearchUsers([])
    setCurrentRestaurant(null)
    setOtherUser(null)
    setPostLikes({})
    setCommentLikes({})
    setIsLoadingInitial(false)
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>, isComment: boolean) {
    if (!e.target.files) return
    
    const files = Array.from(e.target.files)
    const targetArray = isComment ? commentImages : selectedImages
    const maxImages = 20 - targetArray.length
    
    const newFiles = files.slice(0, maxImages)
    const allFiles = [...targetArray, ...newFiles]
    
    const previews = allFiles.map(file => URL.createObjectURL(file))
    
    if (isComment) {
      setCommentImages(allFiles)
      setCommentPreviews(previews)
    } else {
      setSelectedImages(allFiles)
      setImagePreviews(previews)
    }
    
    e.target.value = ''
  }

  function removeImage(index: number, isComment: boolean) {
    if (isComment) {
      const newImages = commentImages.filter((_, i) => i !== index)
      const newPreviews = commentPreviews.filter((_, i) => i !== index)
      setCommentImages(newImages)
      setCommentPreviews(newPreviews)
    } else {
      const newImages = selectedImages.filter((_, i) => i !== index)
      const newPreviews = imagePreviews.filter((_, i) => i !== index)
      setSelectedImages(newImages)
      setImagePreviews(newPreviews)
    }
  }

  async function handleCreateRestaurant(e: React.FormEvent) {
    e.preventDefault()
    
    if (!newName || !newAddress) {
      showAlert('请填写标题和正文')
      return
    }
    
    const formData = new FormData()
    formData.append('name', newName)
    formData.append('address', newAddress)
    formData.append('username', user!.username)
    formData.append('userId', user!.user_id)
    selectedImages.forEach(file => formData.append('images', file))
    
    try {
      const res = await fetch(`${API_BASE}/restaurants`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      })
      const data = await res.json()
      
      if (data.error) {
        showAlert(data.error)
        return
      }
      
      setNewName('')
      setNewAddress('')
      setSelectedImages([])
      setImagePreviews([])
      setPage('main')
      loadRestaurants()
    } catch (e) {
      showAlert('创建失败')
    }
  }

  async function showDetail(id: string) {
    setIsLoadingDetail(true)
    setPage('detail')
    try {
      const res = await fetch(`${API_BASE}/restaurants/${id}`)
      if (!res.ok) {
        setIsLoadingDetail(false)
        const data = await res.json()
        showAlert(data.error || '加载失败')
        return
      }
      const data = await res.json()
      if (!data.images) data.images = []
      if (!data.comments) data.comments = []
      setCurrentRestaurant(data)
      if (user) {
        const postLikeRes = await fetch(`${API_BASE}/likes/post/${id}`, {
          headers: getAuthHeaders()
        })
        const postLikeData = await postLikeRes.json()
        setPostLikes(prev => ({
          ...prev,
          [id]: { count: data.likeCount || 0, liked: postLikeData.userLiked }
        }))
      } else {
        setPostLikes(prev => ({
          ...prev,
          [id]: { count: data.likeCount || 0, liked: false }
        }))
      }
    } catch (e) {
      showAlert('加载失败')
    }
    setIsLoadingDetail(false)
  }

  function showProfile() {
    setNewUsername(user?.username || '')
    setEditingUsername(false)
    loadUserRestaurants()
    setViewFromDetail(false)
    setPage('profile')
  }

  async function showOtherProfile(authorUserId: string) {
    try {
      const res = await fetch(`${API_BASE}/user/${authorUserId}`)
      const userData = await res.json()
      if (userData.error) {
        showAlert('用户不存在')
        return
      }
      setOtherUser(userData)
      
      const res2 = await fetch(`${API_BASE}/user/${authorUserId}/restaurants`)
      const restaurantsData = await res2.json()
      setOtherUserRestaurants(restaurantsData || [])
      
      setViewFromDetail(page === 'detail')
      setPage('otherProfile')
    } catch (e) {
      showAlert('加载失败')
    }
  }

  function adjustTextareaHeight(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px'
  }

  function handleSetReply(comment: { id: string; author_username: string; author_user_id: string }) {
    const replyPrefix = '回复用户 ' + comment.author_username + ': '
    setReplyTo({ id: comment.id, username: comment.author_username, user_id: comment.author_user_id })
    setCommentText(replyPrefix)
    setTimeout(() => {
      if (commentTextareaRef.current) {
        commentTextareaRef.current.focus()
        commentTextareaRef.current.setSelectionRange(replyPrefix.length, replyPrefix.length)
        commentTextareaRef.current.style.height = 'auto'
        commentTextareaRef.current.style.height = commentTextareaRef.current.scrollHeight + 'px'
      }
    }, 0)
  }

  function handleCommentTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    if (replyTo && !value.startsWith('回复用户 ' + replyTo.username + ': ')) {
      setReplyTo(null)
    }
    setCommentText(value)
    adjustTextareaHeight(e)
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault()
    
    if (!commentText && commentImages.length === 0) {
      showAlert('请输入评论内容或图片')
      return
    }
    
    let text = commentText
    let parentId = null
    let replyToUserId = null
    let replyToUsername = null
    
    // Check for reply prefix
    if (replyTo && commentText.startsWith('回复用户 ' + replyTo.username + ': ')) {
      text = commentText.substring(('回复用户 ' + replyTo.username + ': ').length)
      parentId = replyTo.id
      replyToUserId = replyTo.user_id
      replyToUsername = replyTo.username
    }
    
    const formData = new FormData()
    formData.append('username', user!.username)
    formData.append('userId', user!.user_id)
    if (text) formData.append('text', text)
    if (parentId) {
      formData.append('parent_id', parentId)
      formData.append('reply_to_user_id', replyToUserId!)
      formData.append('reply_to_username', replyToUsername!)
    }
    commentImages.forEach(file => formData.append('images', file))
    
    try {
      const res = await fetch(`${API_BASE}/restaurants/${currentRestaurant!.id}/comments`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData })
      const data = await res.json()
      
      if (data.error) {
        showAlert(data.error)
        return
      }
      
      setCommentText('')
      setCommentImages([])
      setCommentPreviews([])
      setReplyTo(null)
      if (commentTextareaRef.current) {
        commentTextareaRef.current.style.height = 'auto'
        commentTextareaRef.current.style.height = '38px'
      }
      showDetail(currentRestaurant!.id)
    } catch (e) {
      showAlert('评论失败')
    }
  }

  async function handleDeletePost(id: string) {
    showConfirm('确定删除此帖子吗？', async () => {
      try {
        const res = await fetch(`${API_BASE}/restaurants/${id}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        })
        const data = await res.json()
        
        if (data.error) {
          showAlert(data.error)
          return
        }
        
        showAlert('删除成功')
        loadUserRestaurants()
        loadRestaurants()
      } catch (e) {
        showAlert('删除失败')
      }
    })
  }

  async function handleDeleteComment(commentId: string) {
    showConfirm('确定删除此评论吗？', async () => {
      try {
        const res = await fetch(`${API_BASE}/comments/${commentId}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        })
        const data = await res.json()
        
        if (data.error) {
          showAlert(data.error)
          return
        }
        
        showAlert('删除成功')
        if (currentRestaurant) {
          showDetail(currentRestaurant.id)
          loadRestaurants()
        }
      } catch (e) {
        showAlert('删除失败')
      }
    })
  }

  async function handleLike(targetId: string, targetType: 'post' | 'comment') {
    if (!user) {
      showAlert('请先登录')
      return
    }
    
    if (user.status === 'banned') {
      showAlert('账号已被封禁')
      return
    }
    
    try {
      const res = await fetch(`${API_BASE}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ target_id: targetId, target_type: targetType })
      })
      const data = await res.json()
      
      if (data.error) {
        showAlert(data.error)
        return
      }
      
      if (targetType === 'post') {
        const currentLiked = postLikes[targetId]?.liked ?? false
        const currentCount = postLikes[targetId]?.count ?? currentRestaurant?.likeCount ?? 0
        const delta = data.liked === currentLiked ? 0 : (data.liked ? 1 : -1)
        setPostLikes(prev => ({
          ...prev,
          [targetId]: {
            count: currentCount + delta,
            liked: data.liked
          }
        }))
      } else {
        const currentLiked = commentLikes[targetId]?.liked ?? false
        const currentCount = commentLikes[targetId]?.count ?? 0
        const delta = data.liked === currentLiked ? 0 : (data.liked ? 1 : -1)
        setCommentLikes(prev => ({
          ...prev,
          [targetId]: {
            count: currentCount + delta,
            liked: data.liked
          }
        }))
      }
    } catch (e) {
      showAlert('操作失败')
    }
  }

  async function handleUpdateUsername() {
    if (!newUsername || !user) return
    
    try {
      const res = await fetch(`${API_BASE}/user/update-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ userId: user.user_id, newUsername })
      })
      const data = await res.json()
      
      if (data.error) {
        showAlert(data.error)
        return
      }
      
      const updatedUser = { ...user, username: newUsername }
      setUser(updatedUser)
      localStorage.setItem('user', JSON.stringify(updatedUser))
      setEditingUsername(false)
      showAlert('用户名修改成功')
    } catch (e) {
      showAlert('修改失败')
    }
  }

  async function handleUpdateAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    
    const formData = new FormData()
    formData.append('userId', user.user_id)
    formData.append('avatar', file)
    
    try {
      const res = await fetch(`${API_BASE}/user/update-avatar`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      })
      const data = await res.json()
      
      if (data.error) {
        showAlert(data.error)
        return
      }
      
      const updatedUser = { ...user, avatar: data.avatar }
      setUser(updatedUser)
      localStorage.setItem('user', JSON.stringify(updatedUser))
      showAlert('头像修改成功')
    } catch (e) {
      showAlert('修改失败')
    }
  }

  function getPermissionName(role: number): string {
    switch(role) {
      case 4: return '最高权限管理员'
      case 3: return '管理员'
      case 2: return '高级用户'
      default: return '普通用户'
    }
  }

  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  
  const [modalInfo, setModalInfo] = useState<{ show: boolean; type: 'showAlert' | 'confirm'; message: string; onConfirm?: () => void }>({ show: false, type: 'showAlert', message: '' })

  function showAlert(msg: string) {
    setModalInfo({ show: true, type: 'showAlert', message: msg })
  }

  function showConfirm(msg: string, onConfirm: () => void) {
    setModalInfo({ show: true, type: 'confirm', message: msg, onConfirm })
  }

  async function handleUpdatePassword() {
    if (!oldPassword || !newPassword) {
      showAlert('请输入旧密码和新密码')
      return
    }
    if (newPassword.length < 6) {
      showAlert('新密码长度需至少6位')
      return
    }
    
    try {
      const res = await fetch(`${API_BASE}/user/update-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ oldPassword, newPassword })
      })
      const data = await res.json()
      
      if (data.error) {
        showAlert(data.error)
        return
      }
      
      showAlert('密码修改成功')
      setShowPasswordModal(false)
      setOldPassword('')
      setNewPassword('')
    } catch (e) {
      showAlert('修改失败')
    }
  }

  function handleDeleteAccountClick() {
    if (!user) return
    
    if (user.role === 4) {
      showAlert('最高管理员不允许注销账号')
      return
    }
    
    showConfirm(`确认注销账号 ${user.username}？此操作不可恢复！`, () => {
      showConfirm(`再次确认：注销账号 ${user.username}？`, () => {
        deleteAccount()
      })
    })
  }
  
  async function deleteAccount() {
    try {
      const res = await fetch(`${API_BASE}/user/delete-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ password: '' })
      })
      const data = await res.json()
      
      if (data.error) {
        showAlert(data.error)
        return
      }
      
      showAlert('账号已注销')
      logout()
    } catch (e) {
      showAlert('注销失败')
    }
  }

  async function handleChangeRole(targetUserId: string, newRole: number) {
    showConfirm(`确定要将用户权限变更为${getPermissionName(newRole)}吗？`, async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/change-role`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ targetUserId, newRole })
        })
        const data = await res.json()
        
        if (data.error) {
          showAlert(data.error)
          return
        }
        
        showAlert(`已将用户权限变更为${getPermissionName(newRole)}，新ID: ${data.user_id}`)
        
        // 如果是当前用户自己，更新本地存储
        if (user && user.user_id === targetUserId) {
          const updatedUser = { ...user, user_id: data.user_id, role: newRole }
          setUser(updatedUser)
          localStorage.setItem('user', JSON.stringify(updatedUser))
        }
        
        const res2 = await fetch(`${API_BASE}/user/${data.user_id}`)
        const userData = await res2.json()
        setOtherUser(userData)
      } catch (e) {
        showAlert('操作失败')
      }
    })
  }

  async function handleBanUser(targetUserId: string, banned: boolean) {
    showConfirm(`确定要${banned ? '封禁' : '解封'}该用户吗？`, async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/ban-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ targetUserId, banned })
        })
        const data = await res.json()
        
        if (data.error) {
          showAlert(data.error)
          return
        }
        
        showAlert(banned ? '用户已封禁' : '用户已解封')
        
        const res2 = await fetch(`${API_BASE}/user/${targetUserId}`)
        const userData = await res2.json()
        setOtherUser(userData)
      } catch (e) {
        showAlert('操作失败')
      }
    })
  }

  if (page === 'auth') {
    return (
      <Box 
          sx={{ 
            minHeight: '100vh', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            p: 2,
            background: '#f5f5f5'
          }}
        >
          <Card sx={{ width: '100%', maxWidth: 400, p: 3 }}>
            <CardContent>
              <Typography 
                variant="h3" 
                align="center" 
                gutterBottom 
                sx={{ 
                  color: 'primary.main', 
                  fontWeight: 700,
                  fontFamily: "'Nunito', 'Microsoft YaHei', sans-serif",
                  fontSize: '2rem'
                }}
              >
                WFLA wall
              </Typography>
              <Typography variant="h6" align="center" gutterBottom sx={{ mb: 2, color: 'text.secondary' }}>
                {isLogin ? '登录' : '注册'}
              </Typography>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
              )}
              <Box component="form" onSubmit={handleAuth}>
                <TextField
                  fullWidth
                  label="用户名"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  margin="normal"
                  variant="outlined"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '12px',
                    },
                  }}
                />
                <TextField
                  fullWidth
                  type="password"
                  label="密码"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  margin="normal"
                  variant="outlined"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '12px',
                    },
                  }}
                />
                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  disabled={loading}
                  sx={{ mt: 2, borderRadius: '24px', py: 1.5, fontSize: '1rem' }}
                >
                  {loading ? '请稍候...' : (isLogin ? '登录' : '注册')}
                </Button>
              </Box>
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Typography variant="body2" component="span">
                  {isLogin ? '没有账号？' : '已有账号？'}
                </Typography>
                <Typography 
                  variant="body2" 
                  component="span" 
                  sx={{ ml: 1, color: 'primary.main', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => { setIsLogin(!isLogin); setError('') }}
                >
                  {isLogin ? '注册' : '登录'}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AppBar position="static" sx={{ bgcolor: 'primary.main' }}>
          <Toolbar>
            <Typography 
              variant="h6" 
              component="div" 
              sx={{ 
                flexGrow: 1, 
                cursor: 'pointer',
                fontFamily: "'Nunito', 'Microsoft YaHei', sans-serif",
                fontWeight: 700,
                fontSize: '1.3rem',
                letterSpacing: 0.5
              }}
              onClick={() => setPage('main')}
            >
              WFLA wall
            </Typography>
            <Box 
              sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
              onClick={showProfile}
            >
              <Avatar src={user?.avatar} sx={{ width: 32, height: 32, mr: 1 }} />
              <Typography variant="body2">{user?.username}</Typography>
            </Box>
          </Toolbar>
        </AppBar>

        {page === 'main' && (
          <Box sx={{ py: 2, px: { xs: 1, sm: 2 }, maxWidth: 1200, mx: 'auto' }}>
            <Paper sx={{ p: 2, mb: 2 }}>
              <Box component="form" onSubmit={handleSearch} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="搜索帖子、用户..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '24px',
                    },
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon />
                      </InputAdornment>
                    ),
                  }}
                />
                <Button 
                  type="submit" 
                  variant="contained" 
                  size="small"
                  sx={{ 
                    borderRadius: '24px',
                    minWidth: 60
                  }}
                >
                  搜索
                </Button>
                {searchQuery.trim() && !isSearching && (
                  <Button variant="outlined" size="small" onClick={clearSearch} sx={{ borderRadius: '24px', minWidth: 60 }}>
                    清除
                  </Button>
                )}
              </Box>
            </Paper>

            {searchQuery.trim() && (
              <Box sx={{ mb: 2 }}>
                <Button 
                  variant={searchType === 'posts' ? 'contained' : 'outlined'} 
                  size="small"
                  sx={{ mr: 1 }}
                  onClick={() => { 
                    setSearchType('posts'); 
                    setSearchUsers([])
                    if (searchQuery.trim()) {
                      setIsSearching(true)
                      searchPosts(searchQuery)
                    }
                  }}
                >
                  帖子
                </Button>
                <Button 
                  variant={searchType === 'users' ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => { 
                    setSearchType('users'); 
                    setSearchResults([])
                    if (searchQuery.trim()) {
                      setIsSearching(true)
                      performUserSearch(searchQuery)
                    }
                  }}
                >
                  用户
                </Button>
              </Box>
            )}

<Grid container spacing={0} sx={{ width: '100%', mx: 0, my: 0 }}>
              {isSearching && (
                <Grid size={12}>
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress />
                  </Box>
                </Grid>
              )}

              {searchQuery.trim() && !isSearching && searchType === 'posts' && searchResults.length === 0 && (
                <Grid size={12}>
                  <Box sx={{ textAlign: 'center', py: 6 }}>
                    <Typography color="text.secondary">未找到相关帖子</Typography>
                  </Box>
                </Grid>
              )}

              {searchQuery.trim() && !isSearching && searchType === 'posts' && (
                <Box sx={{ display: 'flex', gap: 2, width: '100%' }}>
                  <Box sx={{ width: { xs: '100%', sm: '50%' } }}>
                    {searchResults.filter((_, i) => i % 2 === 0).map(r => (
                      <Card key={r.id} sx={{ cursor: 'pointer', mb: 1.5 }} onClick={() => showDetail(r.id)}>
                        {r.images?.[0] && <CardMedia component="img" height="140" image={r.images[0]} alt={r.name} />}
                        <CardContent>
                          <Typography variant="h6">{r.name}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</Typography>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }} onClick={(e) => { e.stopPropagation(); showOtherProfile(r.createdByUserId) }}>
                              <Avatar src={r.authorAvatar || '/user.png'} sx={{ width: 24, height: 24, mr: 0.5 }} />
                              <Typography variant="caption">{r.authorUsername || '用户'} ID:{r.createdByUserId}</Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary">{r.commentCount} 条评论</Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                  <Box sx={{ width: { xs: '100%', sm: '50%' } }}>
                    {searchResults.filter((_, i) => i % 2 === 1).map(r => (
                      <Card key={r.id} sx={{ cursor: 'pointer', mb: 1.5 }} onClick={() => showDetail(r.id)}>
                        {r.images?.[0] && <CardMedia component="img" height="140" image={r.images[0]} alt={r.name} />}
                        <CardContent>
                          <Typography variant="h6">{r.name}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</Typography>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }} onClick={(e) => { e.stopPropagation(); showOtherProfile(r.createdByUserId) }}>
                              <Avatar src={r.authorAvatar || '/user.png'} sx={{ width: 24, height: 24, mr: 0.5 }} />
                              <Typography variant="caption">{r.authorUsername || '用户'} ID:{r.createdByUserId}</Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary">{r.commentCount} 条评论</Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                </Box>
              )}

              {searchQuery.trim() && !isSearching && searchType === 'users' && searchUsers.length === 0 && (
                <Grid size={12}>
                  <Box sx={{ textAlign: 'center', py: 6 }}>
                    <Typography color="text.secondary">未找到相关用户</Typography>
                  </Box>
                </Grid>
              )}

              {searchQuery.trim() && !isSearching && searchType === 'users' && searchUsers.map(u => (
                <Grid size={12} key={u.user_id}>
                  <Card 
                    sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', p: 1 }}
                    onClick={() => showOtherProfile(u.user_id)}
                  >
                    <Avatar src={u.avatar} sx={{ mr: 2 }} />
                    <Box>
                      <Typography>{u.username}</Typography>
                      <Typography variant="caption" color="text.secondary">ID: {u.user_id}</Typography>
                    </Box>
                  </Card>
                </Grid>
              ))}

              {!isSearching && isLoadingInitial && !searchQuery.trim() && Array.from({ length: 4 }).map((_, i) => (
                <Grid size={{ xs: 12, sm: 6 }} key={i}>
                  <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 2 }} />
                </Grid>
              ))}

              {!isSearching && !isLoadingInitial && !searchQuery.trim() && restaurants.length === 0 && (
                <Grid size={12}>
                  <Box sx={{ textAlign: 'center', py: 6 }}>
                    <Typography color="text.secondary">暂无帖子，快来发布吧！</Typography>
                  </Box>
                </Grid>
)}

              {!isSearching && !isLoadingInitial && !searchQuery.trim() && (
                <Box sx={{ display: 'flex', gap: 2, width: '100%' }}>
                  <Box sx={{ width: { xs: '100%', sm: '50%' } }}>
                    {restaurants.filter((_, i) => i % 2 === 0).map(r => (
                      <Card key={r.id} sx={{ cursor: 'pointer', mb: 1.5 }} onClick={() => showDetail(r.id)}>
                        {r.images?.[0] && <CardMedia component="img" height="140" image={r.images[0]} alt={r.name} />}
                        <CardContent>
                          <Typography variant="h6">{r.name}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</Typography>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                              <Avatar src={r.authorAvatar || '/user.png'} sx={{ width: 24, height: 24, mr: 0.5 }} />
                              <Typography variant="caption">{r.authorUsername || '用户'} ID:{r.createdByUserId}</Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary">{r.commentCount} 条评论</Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                  <Box sx={{ width: { xs: '100%', sm: '50%' } }}>
                    {restaurants.filter((_, i) => i % 2 === 1).map(r => (
                      <Card key={r.id} sx={{ cursor: 'pointer', mb: 1.5 }} onClick={() => showDetail(r.id)}>
                        {r.images?.[0] && <CardMedia component="img" height="140" image={r.images[0]} alt={r.name} />}
                        <CardContent>
                          <Typography variant="h6">{r.name}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</Typography>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                              <Avatar src={r.authorAvatar || '/user.png'} sx={{ width: 24, height: 24, mr: 0.5 }} />
                              <Typography variant="caption">{r.authorUsername || '用户'} ID:{r.createdByUserId}</Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary">{r.commentCount} 条评论</Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                </Box>
              )}
            </Grid>
          </Box>
        )}

        {page === 'main' && (
          <Fab 
            color="primary" 
            sx={{ position: 'fixed', bottom: 16, right: 16 }}
            onClick={() => { setNewName(''); setNewAddress(''); setSelectedImages([]); setImagePreviews([]); setPage('create'); }}
          >
            <AddIcon />
          </Fab>
        )}

        {page === 'create' && (
          <Container maxWidth="md" sx={{ py: 2 }}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h5" gutterBottom>发布帖子</Typography>
              <Box component="form" onSubmit={handleCreateRestaurant}>
                <TextField
                  fullWidth
                  label="标题"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  margin="normal"
                  inputProps={{ maxLength: 30 }}
                />
                <TextField
                  fullWidth
                  label="正文"
                  value={newAddress}
                  onChange={e => setNewAddress(e.target.value)}
                  margin="normal"
                  multiline
                  rows={5}
                  inputProps={{ maxLength: 3000 }}
                />
                <Box sx={{ mt: 1, mb: 2 }}>
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={<PhotoCamera />}
                  >
                    添加图片
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif"
                      multiple
                      onChange={e => handleImageSelect(e, false)}
                      style={{ display: 'none' }}
                    />
                  </Button>
                </Box>
                {imagePreviews.length > 0 && (
                  <Grid container spacing={1} sx={{ mb: 2 }}>
                    {imagePreviews.map((src, i) => (
                      <Grid size={i}>
                        <Box sx={{ position: 'relative' }}>
                          <img src={src} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 4 }} />
                          <IconButton
                            size="small"
                            sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'background.paper' }}
                            onClick={() => removeImage(i, false)}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                )}
                <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                  <Button variant="outlined" onClick={() => setPage('main')}>取消</Button>
                  <Button type="submit" variant="contained">发布</Button>
                </Box>
              </Box>
            </Paper>
          </Container>
        )}

        {page === 'detail' && isLoadingDetail && (
          <Box sx={{ p: 2 }}>
            <Skeleton variant="text" width={120} sx={{ mb: 2 }} />
            <Skeleton variant="text" width="60%" height={32} sx={{ mb: 1 }} />
            <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2 }} />
            <Skeleton variant="rectangular" height={200} sx={{ mb: 2 }} />
          </Box>
        )}

        {page === 'detail' && currentRestaurant && !isLoadingDetail && (
          <Box sx={{ p: 2 }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => setPage('main')} sx={{ mb: 2 }}>
              返回
            </Button>
            <div className="detail-info">
            <h1>{currentRestaurant.name}</h1>
            <div className="post-author-info" onClick={() => showOtherProfile(currentRestaurant.createdByUserId)}>
              <img src={(currentRestaurant as any).authorAvatar || '/user.png'} alt="" className="post-author-avatar" />
              <span className="post-author-name">{(currentRestaurant as any).authorUsername || '用户'}</span>
              <span className="post-author-id">ID: {currentRestaurant.createdByUserId}</span>
            </div>
            <p className="content">{currentRestaurant.address}</p>
            {(user && (user.user_id === currentRestaurant.createdByUserId || (user.role > Number((currentRestaurant as any).authorRole || 1)))) && (
              <button className="delete-post-btn" onClick={() => handleDeletePost(currentRestaurant.id)}>删除帖子</button>
            )}
            <div className="like-section" onClick={e => e.stopPropagation()}>
              <IconButton
                onClick={() => handleLike(currentRestaurant.id, 'post')}
                color={postLikes[currentRestaurant.id]?.liked ? 'error' : 'default'}
              >
                {postLikes[currentRestaurant.id]?.liked ? <Favorite /> : <FavoriteBorder />}
              </IconButton>
              <span className="like-count">{postLikes[currentRestaurant.id]?.count ?? currentRestaurant.likeCount ?? 0}</span>
            </div>
          </div>
          {currentRestaurant.images && currentRestaurant.images.length > 0 && (
            <div className="detail-images">
              {currentRestaurant.images.map((img, i) => (
                <img key={i} src={img} alt="" />
              ))}
            </div>
          )}
          
          <div className="comment-form">
            <div className="comment-input-row">
              <textarea
                ref={commentTextareaRef}
                placeholder="写下你的评论..."
                value={commentText}
                maxLength={3000}
                onChange={handleCommentTextChange}
                onBlur={e => { e.target.style.height = 'auto'; e.target.style.height = '38px'; }}
                className={replyTo ? 'reply-active' : ''}
              />
              <Button 
                variant="contained" 
                onClick={handleAddComment}
                sx={{ 
                  bgcolor: 'primary.main',
                  '&:hover': { bgcolor: 'primary.dark' }
                }}
              >
                发布
              </Button>
              <label className="img-btn">
                <IconButton 
                  component="span"
                  sx={{ 
                    transition: 'transform 0.2s',
                    '&:hover': { transform: 'scale(1.2)' }
                  }}
                >
                  <ImageIcon />
                </IconButton>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif"
                  multiple
                  onChange={e => handleImageSelect(e, true)}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
            {commentPreviews.length > 0 && (
              <div className="comment-img-preview">
                {commentPreviews.map((src, i) => (
                  <div key={i} className="preview-item">
                    <img src={src} alt="" />
                    <IconButton
                      size="small"
                      onClick={() => removeImage(i, true)}
                      sx={{ 
                        position: 'absolute', 
                        top: -8, 
                        right: -8, 
                        bgcolor: 'background.paper',
                        '&:hover': { bgcolor: 'error.light' }
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="comment-list">
            <Typography variant="h6" sx={{ mb: 2 }}>{currentRestaurant.comments.length} 条评论</Typography>
            {currentRestaurant.comments.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary">暂无评论，快来抢先评论吧！</Typography>
              </Box>
            ) : (() => {
              const parentComments = currentRestaurant.comments.filter(c => !c.parent_id)
              return parentComments.map(c => {
                const commentMap = new Map()
                currentRestaurant.comments.forEach(comment => {
                  commentMap.set(comment.id, comment)
                })
                const getDescendants = (parentId: string): Comment[] => {
                  const children = currentRestaurant.comments.filter(r => r.parent_id === parentId)
                  let allDescendants: Comment[] = [...children]
                  children.forEach(child => {
                    allDescendants = allDescendants.concat(getDescendants(child.id))
                  })
                  return allDescendants
                }
                const allReplies = getDescendants(c.id).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
                return (
                  <div key={c.id}>
                    <div className="comment-item">
                      <div className="comment-header">
                        <div className="comment-author">
                          <img 
                            src={c.author_avatar || '/user.png'} 
                            alt="" 
                            className="comment-avatar clickable" 
                            onClick={() => showOtherProfile(c.author_user_id)}
                          />
                          <span className="comment-username clickable" onClick={() => showOtherProfile(c.author_user_id)}>{c.author_username || '用户'}</span>
                          <span className="comment-userid">ID: {c.author_user_id}</span>
                        </div>
                        <div className="comment-menu-container">
                          <IconButton
                            size="small"
                            onClick={() => setShowCommentMenu(showCommentMenu === c.id ? null : c.id)}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                          {showCommentMenu === c.id && (
                            <div className="comment-menu">
                              <button onClick={() => { handleSetReply({ id: c.id, author_username: c.author_username || '用户', author_user_id: c.author_user_id }); setShowCommentMenu(null); }}>回复</button>
                              {(user && (user.role >= 3 || user.user_id === c.author_user_id)) && (
                                <button className="danger" onClick={() => { handleDeleteComment(c.id); setShowCommentMenu(null); }}>删除</button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text">{c.text}</div>
                      {c.images && c.images.length > 0 && (
                        <div className="comment-imgs">
                          {c.images.map((img, i) => (
                            <img key={i} src={img} alt="" />
                          ))}
                        </div>
                      )}
                      <div className="time">{new Date(c.time).toLocaleString()}</div>
                      <div className="like-section comment-like">
                        <IconButton
                          size="small"
                          onClick={() => handleLike(c.id, 'comment')}
                          color={commentLikes[c.id]?.liked ? 'error' : 'default'}
                        >
                          {commentLikes[c.id]?.liked ? <Favorite sx={{ fontSize: 16 }} /> : <FavoriteBorder sx={{ fontSize: 16 }} />}
                        </IconButton>
                        <span className="like-count">{commentLikes[c.id]?.count ?? c.likeCount ?? 0}</span>
                      </div>
                    </div>
                    {allReplies.map(r => (
                      <div key={r.id} className="comment-item comment-reply">
                        <div className="comment-header">
                          <div className="comment-author">
                            <img 
                              src={r.author_avatar || '/user.png'} 
                              alt="" 
                              className="comment-avatar clickable" 
                              onClick={() => showOtherProfile(r.author_user_id)}
                            />
                            <span className="comment-username clickable" onClick={() => showOtherProfile(r.author_user_id)}>{r.author_username || '用户'}</span>
                            <span className="comment-userid">ID: {r.author_user_id}</span>
                          </div>
                          <div className="comment-menu-container">
                            <IconButton
                              size="small"
                              onClick={() => setShowCommentMenu(showCommentMenu === r.id ? null : r.id)}
                            >
                              <MoreVertIcon fontSize="small" />
                            </IconButton>
                            {showCommentMenu === r.id && (
                              <div className="comment-menu">
                                <button onClick={() => { handleSetReply({ id: r.id, author_username: r.author_username || '用户', author_user_id: r.author_user_id }); setShowCommentMenu(null); }}>回复</button>
                                {(user && (user.role >= 3 || user.user_id === r.author_user_id)) && (
                                  <button className="danger" onClick={() => { handleDeleteComment(r.id); setShowCommentMenu(null); }}>删除</button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text"><span className="reply-prefix">回复用户 {r.reply_to_username}: </span>{r.text}</div>
                        {r.images && r.images.length > 0 && (
                          <div className="comment-imgs">
                            {r.images.map((img, i) => (
                              <img key={i} src={img} alt="" />
                            ))}
                          </div>
                        )}
                        <div className="time">{new Date(r.time).toLocaleString()}</div>
                        <div className="like-section comment-like">
                          <IconButton
                            size="small"
                            onClick={() => handleLike(r.id, 'comment')}
                            color={commentLikes[r.id]?.liked ? 'error' : 'default'}
                          >
                            {commentLikes[r.id]?.liked ? <Favorite sx={{ fontSize: 16 }} /> : <FavoriteBorder sx={{ fontSize: 16 }} />}
                          </IconButton>
                          <span className="like-count">{commentLikes[r.id]?.count ?? r.likeCount ?? 0}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })
              })()}
            </div>
          </Box>
        )}

      {page === 'profile' && user && (
        <div className="profile-page">
          <Button startIcon={<ArrowBackIcon />} onClick={() => setPage('main')} sx={{ mb: 2 }}>
            返回
          </Button>
          <div className="profile-header">
            <div className="avatar-section">
              <img src={user.avatar} alt="avatar" className="profile-avatar" />
              <label className="avatar-upload-btn">
                修改头像
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUpdateAvatar}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
            <div className="profile-info">
              {editingUsername ? (
                <div className="username-edit">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    placeholder="新用户名"
                  />
                  <button onClick={handleUpdateUsername}>保存</button>
                  <button onClick={() => setEditingUsername(false)}>取消</button>
                </div>
              ) : (
                <div className="username-display">
                  <h2>{user.username}</h2>
                  <button onClick={() => setEditingUsername(true)}>修改用户名</button>
                </div>
              )}
              <p className="user-id">用户ID: {user.user_id}</p>
              <p className="permission">权限: {getPermissionName(user.role)}</p>
            </div>
          </div>

          <div className="my-posts">
            <Typography variant="h6" sx={{ mb: 2 }}>我发布的帖子</Typography>
            {userRestaurants.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary">暂无帖子</Typography>
              </Box>
            ) : (
              userRestaurants.map(r => (
                <div key={r.id} className="user-post-card">
                  <div onClick={() => showDetail(r.id)}>
                    <h4>{r.name}</h4>
                    <p>{r.commentCount} 条评论</p>
                    <span className="post-time">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <button className="delete-btn" onClick={() => handleDeletePost(r.id)}>删除</button>
                </div>
              ))
            )}
          </div>

          <div className="profile-actions">
            <button className="action-btn" onClick={() => setShowPasswordModal(true)}>修改密码</button>
            {user.role !== 4 && (
              <button className="action-btn danger" onClick={handleDeleteAccountClick}>注销账号</button>
            )}
          </div>

          {showPasswordModal && (
            <div className="modal-overlay">
              <div className="modal">
                <h3>修改密码</h3>
                <input type="password" placeholder="旧密码" value={oldPassword} onChange={e => setOldPassword(e.target.value)} />
                <input type="password" placeholder="新密码" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                <div className="modal-buttons">
                  <button onClick={() => setShowPasswordModal(false)}>取消</button>
                  <button className="primary" onClick={handleUpdatePassword}>确认</button>
                </div>
              </div>
            </div>
          )}

          <button className="logout-btn-full" onClick={logout}>退出登录</button>
        </div>
      )}

      {page === 'otherProfile' && otherUser && (
        <div className="profile-page">
          <Button 
            startIcon={<ArrowBackIcon />} 
            onClick={() => viewFromDetail ? setPage('detail') : setPage('main')} 
            sx={{ mb: 2 }}
          >
            {viewFromDetail ? '返回帖子' : '返回'}
          </Button>
          <div className="profile-header">
            <div className="avatar-section">
              <img src={otherUser.avatar} alt="avatar" className="profile-avatar" />
            </div>
            <div className="profile-info">
              <div className="username-display">
                <h2>{otherUser.username}</h2>
              </div>
              <p className="user-id">用户ID: {otherUser.user_id}</p>
              <p className="permission">权限: {getPermissionName(otherUser.role)}</p>
              {otherUser.status === 'banned' && <p className="user-banned">已封禁</p>}
            </div>
          </div>

          {user && user.role >= 3 && otherUser.user_id !== user.user_id && (
            <div className="admin-actions">
              <h3>管理操作</h3>
              <div className="action-buttons">
                {otherUser.role < 3 && (
                  <button onClick={() => handleChangeRole(otherUser.user_id, otherUser.role + 1)}>
                    升级为{getPermissionName(otherUser.role + 1)}
                  </button>
                )}
                {otherUser.role > 1 && (
                  <button onClick={() => handleChangeRole(otherUser.user_id, otherUser.role - 1)}>
                    降级为{getPermissionName(otherUser.role - 1)}
                  </button>
                )}
                {otherUser.status === 'banned' ? (
                  <button onClick={() => handleBanUser(otherUser.user_id, false)}>解封用户</button>
                ) : (
                  <button className="danger" onClick={() => handleBanUser(otherUser.user_id, true)}>封禁用户</button>
                )}
              </div>
            </div>
          )}

          <div className="my-posts">
            <Typography variant="h6" sx={{ mb: 2 }}>TA发布的帖子</Typography>
            {otherUserRestaurants.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography color="text.secondary">暂无帖子</Typography>
              </Box>
            ) : (
              otherUserRestaurants.map(r => (
                <div key={r.id} className="user-post-card">
                  <div onClick={() => showDetail(r.id)}>
                    <h4>{r.name}</h4>
                    <p>{r.commentCount} 条评论</p>
                    <span className="post-time">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {modalInfo.show && (
        <Dialog open={modalInfo.show} onClose={() => setModalInfo({ show: false, type: 'showAlert', message: '' })}>
          <DialogContent>
            <Typography align="center">{modalInfo.message}</Typography>
          </DialogContent>
          <DialogActions>
            {modalInfo.type === 'confirm' ? (
              <>
                <Button onClick={() => setModalInfo({ show: false, type: 'showAlert', message: '' })}>取消</Button>
                <Button variant="contained" onClick={() => { setModalInfo({ show: false, type: 'showAlert', message: '' }); modalInfo.onConfirm?.() }}>确认</Button>
              </>
            ) : (
              <Button variant="contained" fullWidth onClick={() => setModalInfo({ show: false, type: 'showAlert', message: '' })}>确定</Button>
            )}
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}

export default App
