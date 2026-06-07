// ─────── Supabase ───────
const SUPABASE_URL = 'https://etdkanqajrcxjytfxyyq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0ZGthbnFhanJjeGp5dGZ4eXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1OTIwNDYsImV4cCI6MjA5MjE2ODA0Nn0.-3KH6A6tfNvCeXPl7UIB92gL5BiO77ZrDEwlkbkZ1Ns';
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─────── State ───────
const state = {
    user: null,
    profile: null,
    followings: new Set(),
    viewedPosts: new Set(),
    viewTimers: new Map(),
    currentFeedTab: 'foryou',
    currentViewProfileId: null,
    currentChatUserId: null,
    currentChatGroupId: null,
    commentPostId: null,
    sharePostId: null,
    replyToMsgId: null,
    chatFile: null,
    stagedFiles: [],
    messageInterval: null,
};

// ─────── Toast ───────
function toast(message, type = '') {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// ─────── DOM Helpers ───────
function $(id) { return document.getElementById(id); }

function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }

function getStringColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

// ─────── Observers ───────
const videoObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
        const video = e.target;
        const hidden = video.closest('.hidden');
        if (e.isIntersecting && !hidden) {
            video.play().catch(() => {});
        } else {
            video.pause();
            video.currentTime = 0;
        }
    });
}, { threshold: 0.6 });

const feedObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
        const postId = e.target.id.replace('post-container-', '');
        if (e.isIntersecting) {
            const timer = setTimeout(() => {
                const el = $(`view-count-${postId}`);
                if (el) el.textContent = (parseInt(el.textContent) || 0) + 1;
                client.rpc('record_post_view', { p_user_id: state.user?.id || null, p_post_id: postId })
                    .catch(() => {});
            }, 1000);
            state.viewTimers.set(postId, timer);
        } else {
            if (state.viewTimers.has(postId)) {
                clearTimeout(state.viewTimers.get(postId));
                state.viewTimers.delete(postId);
            }
        }
    });
}, { threshold: 0.6 });

// ─────── Keyboard ───────
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        document.querySelectorAll('.post video').forEach(video => {
            if (video.offsetParent !== null) {
                const r = video.getBoundingClientRect();
                if (r.top >= -window.innerHeight * 0.5 && r.bottom <= window.innerHeight * 1.5) {
                    video.paused ? video.play().catch(() => {}) : video.pause();
                }
            }
        });
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        document.querySelectorAll('video').forEach(v => v.pause());
    } else {
        document.querySelectorAll('.post video').forEach(video => {
            if (video.offsetParent !== null) {
                const r = video.getBoundingClientRect();
                if (r.top >= -window.innerHeight * 0.5 && r.bottom <= window.innerHeight * 1.5) {
                    video.play().catch(() => {});
                }
            }
        });
    }
});

// ─────── Feed Scroll (snap) ───────
let scrolling = false;
const feed = $('feed');
feed?.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (scrolling) return;
    scrolling = true;
    feed.scrollBy({ top: (e.deltaY > 0 ? 1 : -1) * window.innerHeight, behavior: 'smooth' });
    setTimeout(() => { scrolling = false; }, 600);
}, { passive: false });

// ─────── Navigation ───────
function switchTab(tabId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const btn = $(`nav-${tabId}`);
    if (btn) btn.classList.add('active');

    document.querySelectorAll('#feed video').forEach(v => v.pause());
    hideAllModals();

    if (tabId === 'home') {
        feed.classList.remove('hidden');
        $('topFeedNav').classList.remove('hidden');
        setTimeout(() => {
            const v = feed.querySelector('.post video');
            if (v) {
                const r = v.getBoundingClientRect();
                if (r.top >= -window.innerHeight * 0.5 && r.bottom <= window.innerHeight * 1.5) {
                    v.play().catch(() => {});
                }
            }
        }, 100);
    } else {
        feed.classList.add('hidden');
        $('topFeedNav').classList.add('hidden');
        if (tabId === 'search') showModal('searchModal');
        else if (tabId === 'upload') { if (!state.user) showModal('authModal'); else showModal('uploadModal'); }
        else if (tabId === 'profile') { if (!state.user) showModal('authModal'); else showModal('profileModal'); }
        else if (tabId === 'messages') { if (!state.user) showModal('authModal'); else { showModal('messagesModal'); loadInbox(); } }
    }
}

function hideAllModals() {
    ['searchModal','uploadModal','authModal','profileModal','viewProfileModal','singlePostModal','listModal','commentsModal','messagesModal','chatModal','createGroupModal','sharePostModal'].forEach(id => hideModal(id));
}

// Feed tabs: For You / Following
function switchFeedTab(mode) {
    state.currentFeedTab = mode;
    document.querySelectorAll('.top-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.top-nav-btn[data-tab="${mode}"]`).classList.add('active');
    loadFeed();
}

// ─────── Auth ───────
function toggleAuthView(view) {
    $('loginView').classList.toggle('hidden', view !== 'login');
    $('registerView').classList.toggle('hidden', view !== 'register');
}

async function signUp() {
    const username = $('registerUsername').value.trim();
    const email = $('registerEmail').value.trim();
    const password = $('registerPassword').value;
    if (!username) return toast('Username is required!', 'error');
    if (password.length < 6) return toast('Password must be at least 6 characters', 'error');

    const { data, error } = await client.auth.signUp({ email, password });
    if (error) return toast(error.message, 'error');
    if (data.user) {
        const { error: pe } = await client.from('profiles').upsert({ id: data.user.id, username });
        if (pe) console.error('Profile creation error:', pe);
        toast('Check your email for confirmation!');
    }
}

async function signIn() {
    const email = $('loginEmail').value;
    const password = $('loginPassword').value;
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return toast(error.message, 'error');
    $('loginEmail').value = '';
    $('loginPassword').value = '';
}

async function signOut() {
    await client.auth.signOut();
    hideModal('profileModal');
}

// ─────── Profile ───────
async function loadMyProfile() {
    if (!state.user) return;
    const { data } = await client.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    if (data) {
        state.profile = data;
        $('username').value = data.username || '';
        $('displayName').value = data.display_name || '';
        $('bio').value = data.bio || '';
        $('avatarPreview').style.backgroundImage = data.avatar_url ? `url(${data.avatar_url})` : 'none';
    }
    const stats = await getFollowStats(state.user.id);
    $('myFollowersCount').textContent = stats.followers;
    $('myFollowingCount').textContent = stats.following;

    const grid = $('myProfilePosts');
    grid.innerHTML = '';
    const { data: posts } = await client.from('posts').select('*, profiles(username, avatar_url), likes(user_id), comments(id)').eq('user_id', state.user.id).order('created_at', { ascending: false });
    if (posts) posts.forEach(p => grid.appendChild(createGridItem(p)));
}

async function saveProfile() {
    $('profileStatus').textContent = 'Saving...';
    const username = $('username').value;
    const displayName = $('displayName').value;
    const bio = $('bio').value;
    const file = $('avatarInput').files[0];
    let avatar_url = state.profile?.avatar_url || null;

    if (file) {
        const name = `${state.user.id}_${Date.now()}`;
        const { error: ue } = await client.storage.from('avatars').upload(name, file);
        if (!ue) avatar_url = client.storage.from('avatars').getPublicUrl(name).data.publicUrl;
    }

    const { error } = await client.from('profiles').upsert({ id: state.user.id, username, display_name: displayName, bio, avatar_url });
    if (error) return $('profileStatus').textContent = 'Error saving profile.';
    $('profileStatus').textContent = 'Saved!';
    await loadMyProfile();
    setTimeout(() => $('profileStatus').textContent = '', 2000);
}

function previewAvatar(e) {
    const file = e.target.files[0];
    if (file) $('avatarPreview').style.backgroundImage = `url(${URL.createObjectURL(file)})`;
}

async function viewProfile(userId) {
    if (state.user && userId === state.user.id) return switchTab('profile');
    document.querySelectorAll('#feed video').forEach(v => v.pause());
    state.currentViewProfileId = userId;
    showModal('viewProfileModal');

    $('viewDisplayName').textContent = 'Loading...';
    $('viewDisplayName2').textContent = 'Loading...';
    $('viewUsername').textContent = '';
    $('viewBio').textContent = '';
    $('viewAvatar').style.backgroundImage = 'none';

    const { data: p } = await client.from('profiles').select('*').eq('id', userId).single();
    if (p) {
        $('viewDisplayName').textContent = p.display_name || 'Anonymous';
        $('viewDisplayName2').textContent = p.display_name || 'Anonymous';
        $('viewUsername').textContent = '@' + (p.username || 'anonymous');
        $('viewBio').textContent = p.bio || 'No bio yet';
        if (p.avatar_url) $('viewAvatar').style.backgroundImage = `url(${p.avatar_url})`;
    }

    const stats = await getFollowStats(userId);
    $('viewFollowersCount').textContent = stats.followers;
    $('viewFollowingCount').textContent = stats.following;

    const fb = $('profileFollowBtn');
    const mb = $('profileMessageBtn');
    if (state.user) {
        fb.classList.remove('hidden');
        mb.classList.remove('hidden');
        fb.textContent = state.followings.has(userId) ? 'Following' : 'Follow';
        fb.classList.toggle('following', state.followings.has(userId));
    } else {
        fb.classList.add('hidden');
        mb.classList.add('hidden');
    }

    const grid = $('viewProfilePosts');
    grid.innerHTML = '';
    const { data: posts } = await client.from('posts').select('*, profiles(username, avatar_url), likes(user_id)').eq('user_id', userId).order('created_at', { ascending: false });
    if (posts) posts.forEach(p => grid.appendChild(createGridItem(p)));
}

function closeViewProfileModal() {
    hideModal('viewProfileModal');
    if (feed.offsetParent !== null) {
        document.querySelectorAll('#feed video').forEach(v => {
            const r = v.getBoundingClientRect();
            if (r.top >= -window.innerHeight * 0.5 && r.bottom <= window.innerHeight * 1.5) v.play().catch(() => {});
        });
    }
}

function createGridItem(post) {
    const wrapper = document.createElement('div');
    wrapper.className = 'grid-item';
    wrapper.onclick = () => openSinglePost(post);
    const media = post.media_type === 'video'
        ? `<video src="${post.media_url}" muted playsinline></video>`
        : `<img src="${post.media_url}">`;
    wrapper.innerHTML = `${media}<div class="grid-overlay"><span class="material-icons">visibility</span>${post.views || 0}</div>`;
    return wrapper;
}

// ─────── Follows ───────
async function fetchMyFollowings() {
    if (!state.user) return;
    const { data } = await client.from('follows').select('following_id').eq('follower_id', state.user.id);
    if (data) state.followings = new Set(data.map(f => f.following_id));
}

async function toggleFollow(targetUserId, isProfile = false) {
    if (!state.user) return toast('Please login to follow!', 'error');
    const isFollowing = state.followings.has(targetUserId);
    if (isFollowing) {
        await client.from('follows').delete().match({ follower_id: state.user.id, following_id: targetUserId });
        state.followings.delete(targetUserId);
    } else {
        await client.from('follows').insert([{ follower_id: state.user.id, following_id: targetUserId }]);
        state.followings.add(targetUserId);
    }
    if (isProfile) {
        if (state.currentViewProfileId) viewProfile(state.currentViewProfileId);
    } else {
        loadFeed();
    }
}

async function getFollowStats(userId) {
    const { count: f1 } = await client.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId);
    const { count: f2 } = await client.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId);
    return { followers: f1 || 0, following: f2 || 0 };
}

async function showFollowList(type, userId) {
    showModal('listModal');
    $('listTitle').textContent = type === 'followers' ? 'Followers' : 'Following';
    const container = $('listContainer');
    container.innerHTML = '<p style="text-align:center;color:var(--text2);padding:20px;">Loading...</p>';

    let query;
    if (type === 'followers') {
        query = client.from('follows').select('profiles!follows_follower_id_fkey(id, username, avatar_url)').eq('following_id', userId);
    } else {
        query = client.from('follows').select('profiles!follows_following_id_fkey(id, username, avatar_url)').eq('follower_id', userId);
    }
    const { data } = await query;
    container.innerHTML = '';
    if (!data || !data.length) return container.innerHTML = '<p style="text-align:center;color:var(--text2);padding:20px;">No users found.</p>';

    data.forEach(item => {
        const u = item.profiles;
        const row = document.createElement('div');
        row.className = 'list-user-row';
        row.onclick = () => { hideModal('listModal'); viewProfile(u.id); };
        row.innerHTML = `<div class="post-avatar" style="background-image:url('${u.avatar_url || ''}')"></div><span class="list-user-name">@${u.username || 'Anonymous'}</span>`;
        container.appendChild(row);
    });
}

// ─────── Feed ───────
async function loadFeed() {
    feed.innerHTML = '<div class="skeleton" style="height:100%;width:100%;border-radius:0;"></div>';

    let query = client.from('posts').select('*, profiles(username, avatar_url), likes(user_id), comments(id), engagement_score');

    if (state.currentFeedTab === 'following') {
        if (!state.user) return feed.innerHTML = '<div style="text-align:center;padding:50vh 20px;color:var(--text2)">Please login to see followed accounts.</div>';
        if (state.followings.size === 0) return feed.innerHTML = '<div style="text-align:center;padding:50vh 20px;color:var(--text2)">You are not following anyone yet.</div>';
        query = query.in('user_id', Array.from(state.followings));
    }

    const { data: posts, error } = await query.order('engagement_score', { ascending: false }).limit(60);
    if (error || !posts) return feed.innerHTML = '<div style="text-align:center;padding:50vh 20px;">Error loading feed.</div>';

    let unseen = [], seen = [];

    if (state.user) {
        const { data: vd } = await client.from('post_views').select('post_id').eq('user_id', state.user.id);
        const viewedIds = new Set(vd ? vd.map(v => v.post_id) : []);

        const { data: ul, error: le } = await client.from('likes').select('posts(tags)').eq('user_id', state.user.id).limit(20);
        const prefs = {};
        if (ul && !le) {
            ul.forEach(l => {
                const likedPost = Array.isArray(l.posts) ? l.posts[0] : l.posts;
                if (likedPost && Array.isArray(likedPost.tags)) {
                    likedPost.tags.forEach(t => prefs[t] = (prefs[t] || 0) + 1);
                }
            });
        }

        posts.forEach(p => {
            let tagScore = 0;
            (p.tags || []).forEach(t => { if (prefs[t]) tagScore += prefs[t]; });
            p.calculated_score = p.engagement_score + (tagScore * 10);
            if (viewedIds.has(p.id)) seen.push(p); else unseen.push(p);
        });
        unseen.sort((a, b) => b.calculated_score - a.calculated_score);
        seen.sort((a, b) => b.calculated_score - a.calculated_score);
    } else {
        unseen = posts;
    }

    feed.innerHTML = '';
    feed.scrollTop = 0;

    unseen.forEach(p => { feed.appendChild(createPostElement(p)); });
    if (state.user && seen.length > 0) {
        if (unseen.length > 0) {
            const div = document.createElement('div');
            div.className = 'caught-up';
            div.innerHTML = '<span class="material-icons">check_circle</span><h2>You\'re all caught up!</h2><p>Here are some older posts.</p>';
            feed.appendChild(div);
        }
        seen.forEach(p => { feed.appendChild(createPostElement(p)); });
    }

    setTimeout(() => {
        const fv = feed.querySelector('.post video');
        if (fv) fv.play().catch(() => {});
    }, 200);
}

// ─────── Create Post Element ───────
function createPostElement(post) {
    const div = document.createElement('div');
    div.className = 'post';
    div.id = `post-container-${post.id}`;

    const liked = state.user && post.likes?.some(l => l.user_id === state.user.id);
    const likeCount = post.likes?.length || 0;
    const commentCount = post.comments?.length || 0;
    const author = post.profiles?.username || 'Anonymous';
    const avatar = post.profiles?.avatar_url || '';
    const isFollowing = state.followings.has(post.user_id);

    let mediaHtml = '';

    if (post.media_type === 'carousel' || (post.media_urls && post.media_urls.length > 1)) {
        const urls = post.media_urls || [post.media_url];
        const items = urls.map((u, i) => `<div class="carousel-item"><img src="${u}"></div>`).join('');
        const dots = urls.map((_, i) => `<div class="carousel-dot${i === 0 ? ' active' : ''}" id="dot-${post.id}-${i}"></div>`).join('');
        mediaHtml = `
            <button class="carousel-btn left material-icons" onclick="event.stopPropagation();scrollCarousel('${post.id}',-1)">chevron_left</button>
            <div class="carousel-container" id="carousel-${post.id}" onscroll="updateCarouselDots('${post.id}',${urls.length})">${items}</div>
            <button class="carousel-btn right material-icons" onclick="event.stopPropagation();scrollCarousel('${post.id}',1)">chevron_right</button>
            <div class="carousel-dots">${dots}</div>`;
    } else if (post.media_type === 'video') {
        mediaHtml = `<video src="${post.media_url}" loop playsinline></video><div class="play-indicator material-icons">play_arrow</div>`;
    } else {
        mediaHtml = `<img src="${post.media_url}">`;
    }

    let followBtn = '';
    if (state.user && state.user.id !== post.user_id) {
        followBtn = `<button class="feed-follow-btn${isFollowing ? ' following' : ''}" onclick="event.stopPropagation();toggleFollow('${post.user_id}')">${isFollowing ? 'Following' : 'Follow'}</button>`;
    }

    let menuHtml = '';
    if (state.user && post.user_id === state.user.id) {
        menuHtml = `<button class="more-btn material-icons" onclick="event.stopPropagation();togglePostMenu(event)">more_vert</button>
            <div class="post-menu hidden"><button onclick="deletePost('${post.id}','${post.user_id}')">Delete Post</button></div>`;
    }

    div.innerHTML = `
        ${menuHtml}${mediaHtml}
        <div class="post-overlay">
            <div class="post-info">
                <div class="post-author" onclick="viewProfile('${post.user_id}')">
                    <div class="post-avatar" style="background-image:url('${avatar}')"></div>
                    <span class="post-username">@${author}</span>
                    ${followBtn}
                </div>
                ${post.description ? `<div class="post-desc">${post.description}</div>` : ''}
            </div>
            <div class="post-actions">
                <div class="action-icon" id="like-btn-${post.id}" onclick="toggleLike('${post.id}',this)">
                    <span class="material-icons">${liked ? 'favorite' : 'favorite_border'}</span>
                    <span class="action-count" id="like-count-${post.id}">${likeCount}</span>
                </div>
                <div class="action-icon" onclick="openComments('${post.id}')">
                    <span class="material-icons">chat</span>
                    <span class="action-count" id="comment-count-${post.id}">${commentCount}</span>
                </div>
                <div class="action-icon">
                    <span class="material-icons">visibility</span>
                    <span class="action-count" id="view-count-${post.id}">${post.views || 0}</span>
                </div>
                <div class="action-icon" onclick="openShareModal('${post.id}')">
                    <span class="material-icons">send</span>
                </div>
            </div>
        </div>`;

    // Tap handling
    let clickTimer = null;
    div.addEventListener('click', (e) => {
        if (e.target.closest('.post-overlay') || e.target.closest('.more-btn')) return;
        if (clickTimer === null) {
            clickTimer = setTimeout(() => {
                clickTimer = null;
                const v = div.querySelector('video');
                if (v) { v.paused ? v.play().catch(() => {}) : v.pause(); }
            }, 250);
        } else {
            clearTimeout(clickTimer); clickTimer = null;
            handleDoubleTap(post.id);
            const heart = document.createElement('span');
            heart.className = 'material-icons tap-heart';
            heart.textContent = 'favorite';
            div.appendChild(heart);
            setTimeout(() => heart.remove(), 800);
        }
    });

    const video = div.querySelector('video');
    if (video) {
        video.addEventListener('pause', () => div.classList.add('is-paused'));
        video.addEventListener('play', () => div.classList.remove('is-paused'));
        if (video.paused) div.classList.add('is-paused');
        videoObserver.observe(video);
    }

    feedObserver.observe(div);
    return div;
}

// ─────── Double Tap ───────
function handleDoubleTap(postId) {
    if (!state.user) return;
    const btn = $(`like-btn-${postId}`);
    const count = $(`like-count-${postId}`);
    if (btn) toggleLike(postId, btn);
}

// ─────── Carousel ───────
function scrollCarousel(postId, direction) {
    const c = $(`carousel-${postId}`);
    if (c) c.scrollBy({ left: direction * c.clientWidth, behavior: 'smooth' });
}

function updateCarouselDots(postId, total) {
    const c = $(`carousel-${postId}`);
    if (!c) return;
    const idx = Math.round(c.scrollLeft / c.clientWidth);
    for (let i = 0; i < total; i++) {
        const dot = $(`dot-${postId}-${i}`);
        if (dot) dot.classList.toggle('active', i === idx);
    }
}

// ─────── Delete ───────
function togglePostMenu(event) {
    const menu = event.target.nextElementSibling;
    if (menu) menu.classList.toggle('hidden');
}

async function deletePost(postId, postUserId) {
    if (!state.user || state.user.id !== postUserId) return toast('You can only delete your own posts.', 'error');
    if (!confirm('Delete this post?')) return;
    const { error } = await client.from('posts').delete().eq('id', postId).eq('user_id', state.user.id);
    if (error) return toast('Failed: ' + error.message, 'error');
    const el = $(`post-container-${postId}`);
    if (el) el.remove();
    hideModal('singlePostModal');
    if (state.user) loadMyProfile();
}

// ─────── Likes ───────
async function toggleLike(postId, btnEl) {
    if (!state.user) return toast('Please login to like!', 'error');
    const isLiked = btnEl.querySelector('.material-icons').textContent === 'favorite';
    const countEl = btnEl.querySelector('.action-count');

    if (isLiked) {
        await client.from('likes').delete().match({ user_id: state.user.id, post_id: postId });
        btnEl.querySelector('.material-icons').textContent = 'favorite_border';
        countEl.textContent = parseInt(countEl.textContent) - 1;
        btnEl.classList.remove('liked');
    } else {
        await client.from('likes').insert([{ user_id: state.user.id, post_id: postId }]);
        btnEl.querySelector('.material-icons').textContent = 'favorite';
        countEl.textContent = parseInt(countEl.textContent) + 1;
        btnEl.classList.add('liked');
    }
}

// ─────── Comments ───────
function openComments(postId) {
    state.commentPostId = postId;
    showModal('commentsModal');
    $('newCommentInput').value = '';
    loadComments(postId);
}

async function loadComments(postId) {
    const list = $('commentsList');
    list.innerHTML = '<p style="text-align:center;color:var(--text2);padding:20px;">Loading...</p>';
    const { data, error } = await client.from('comments').select('*, profiles(username, avatar_url)').eq('post_id', postId).order('created_at', { ascending: true });
    if (error) return list.innerHTML = '<p style="text-align:center;color:var(--text2);padding:20px;">Error loading comments.</p>';
    if (!data || !data.length) return list.innerHTML = '<p style="text-align:center;color:var(--text2);padding:20px;">No comments yet. Be the first!</p>';
    list.innerHTML = '';
    data.forEach(c => {
        const row = document.createElement('div');
        row.className = 'comment-row';
        row.innerHTML = `<div class="post-avatar" style="background-image:url('${c.profiles?.avatar_url || ''}')"></div>
            <div class="comment-body">
                <div class="comment-user" onclick="hideModal('commentsModal');viewProfile('${c.user_id}')">@${c.profiles?.username || 'Anonymous'}</div>
                <div class="comment-text">${c.content}</div>
            </div>`;
        list.appendChild(row);
    });
    list.scrollTop = list.scrollHeight;
}

async function postComment() {
    if (!state.user) return toast('Please login to comment!', 'error');
    const input = $('newCommentInput');
    const content = input.value.trim();
    if (!content) return;
    input.disabled = true;
    const { error } = await client.from('comments').insert([{ post_id: state.commentPostId, user_id: state.user.id, content }]);
    input.disabled = false;
    if (error) return toast('Error: ' + error.message, 'error');
    input.value = '';
    await loadComments(state.commentPostId);
    const el = $(`comment-count-${state.commentPostId}`);
    if (el) el.textContent = parseInt(el.textContent) + 1;
}

// ─────── Upload ───────
function handleFileSelection(e) {
    const files = Array.from(e.target.files);
    if (state.stagedFiles.length + files.length > 10) {
        toast('Max 10 files allowed.', 'error');
        state.stagedFiles.push(...files.slice(0, 10 - state.stagedFiles.length));
    } else {
        state.stagedFiles.push(...files);
    }
    const hasVideo = state.stagedFiles.some(f => f.type.startsWith('video/'));
    if (hasVideo && state.stagedFiles.length > 1) {
        toast('Videos must be uploaded one at a time.', 'error');
        state.stagedFiles = [];
    }
    e.target.value = '';
    renderStaged();
}

function removeStaged(index) {
    state.stagedFiles.splice(index, 1);
    renderStaged();
}

function renderStaged() {
    const c = $('stagedFilesContainer');
    c.innerHTML = '';
    if (!state.stagedFiles.length) return;
    state.stagedFiles.forEach((f, i) => {
        const url = URL.createObjectURL(f);
        const w = document.createElement('div');
        w.className = 'staged-file';
        w.innerHTML = `${f.type.startsWith('video/') ? `<video src="${url}" muted></video>` : `<img src="${url}">`}<button class="staged-file-remove" onclick="removeStaged(${i})">X</button>`;
        c.appendChild(w);
    });
    if (state.stagedFiles.length > 1) {
        const btn = document.createElement('button');
        btn.textContent = 'Clear All';
        btn.className = 'btn-ghost';
        btn.style.width = 'auto';
        btn.style.padding = '6px 14px';
        btn.style.fontSize = '12px';
        btn.onclick = () => { state.stagedFiles = []; renderStaged(); };
        c.appendChild(btn);
    }
}

async function uploadMedia() {
    if (!state.stagedFiles.length) return toast('Select at least one file', 'error');
    const status = $('uploadStatus');
    status.textContent = 'Uploading...';

    const type = state.stagedFiles[0].type.startsWith('video/') ? 'video' : (state.stagedFiles.length > 1 ? 'carousel' : 'image');
    const desc = $('postDescription').value;
    const hashtags = desc.match(/#[\w]+/g) || [];
    const tags = hashtags.map(t => t.replace('#', '').toLowerCase());

    const urls = [];
    for (let i = 0; i < state.stagedFiles.length; i++) {
        status.textContent = `Uploading ${i + 1}/${state.stagedFiles.length}...`;
        const name = `${Date.now()}_${state.stagedFiles[i].name}`;
        const { error: se } = await client.storage.from('media').upload(name, state.stagedFiles[i]);
        if (se) return status.textContent = 'Upload error: ' + se.message;
        urls.push(client.storage.from('media').getPublicUrl(name).data.publicUrl);
    }

    status.textContent = 'Saving...';
    const { error: dbError } = await client.from('posts').insert([{
        user_id: state.user.id,
        media_url: urls[0],
        media_urls: urls,
        media_type: type,
        description: desc,
        tags
    }]);

    if (dbError) return status.textContent = 'DB error: ' + dbError.message;
    status.textContent = 'Posted!';
    $('postDescription').value = '';
    state.stagedFiles = [];
    renderStaged();
    setTimeout(() => { status.textContent = ''; switchTab('home'); }, 1000);
    if (state.user) loadMyProfile();
}

// ─────── Search ───────
let searchTimeout;
async function searchUsers() {
    clearTimeout(searchTimeout);
    const query = $('searchInput').value.trim();
    const c = $('searchResults');
    if (!query) return c.innerHTML = '';
    searchTimeout = setTimeout(async () => {
        c.innerHTML = '<p style="text-align:center;color:var(--text2);padding:20px;">Searching...</p>';
        const { data, error } = await client.from('profiles').select('id, username, avatar_url').ilike('username', `%${query}%`).limit(20);
        if (error) return c.innerHTML = '<p style="text-align:center;color:var(--text2);padding:20px;">Error.</p>';
        c.innerHTML = '';
        if (!data || !data.length) return c.innerHTML = '<p style="text-align:center;color:var(--text2);padding:20px;">No users found.</p>';
        data.forEach(u => {
            const row = document.createElement('div');
            row.className = 'list-user-row';
            row.onclick = () => { hideModal('searchModal'); viewProfile(u.id); };
            row.innerHTML = `<div class="post-avatar" style="background-image:url('${u.avatar_url || ''}')"></div><span class="list-user-name">@${u.username || 'Anonymous'}</span>`;
            c.appendChild(row);
        });
    }, 300);
}

// ─────── Messages ───────
function openChat(userId, groupId) {
    state.currentChatUserId = userId;
    state.currentChatGroupId = groupId;
    showModal('chatModal');
    $('chatMessages').innerHTML = '<p style="text-align:center;padding:40px;color:var(--text2)">Loading...</p>';

    if (groupId) {
        client.from('group_chats').select('*').eq('id', groupId).single().then(({ data: g }) => {
            if (g) {
                $('chatUsername').textContent = g.name;
                $('chatAvatar').style.backgroundImage = g.avatar_url ? `url(${g.avatar_url})` : 'none';
                $('chatAvatar').innerHTML = g.avatar_url ? '' : '<span class="material-icons" style="line-height:36px;text-align:center;width:100%;font-size:18px">group</span>';
            }
        });
    } else {
        client.from('profiles').select('username, avatar_url').eq('id', userId).single().then(({ data: p }) => {
            if (p) {
                $('chatUsername').textContent = '@' + p.username;
                $('chatAvatar').style.backgroundImage = p.avatar_url ? `url(${p.avatar_url})` : 'none';
                $('chatAvatar').innerHTML = '';
                client.from('messages').update({ is_read: true }).eq('sender_id', userId).eq('receiver_id', state.user.id).then(() => {});
            }
        });
    }
    setTimeout(loadChatMessages, 100);
}

function closeChat() {
    hideModal('chatModal');
    state.currentChatUserId = null;
    state.currentChatGroupId = null;
    state.replyToMsgId = null;
    state.chatFile = null;
    cancelReply();
    cancelChatFile();
    if (!$('messagesModal').classList.contains('hidden')) loadInbox();
}

function initiateReply(msgId, snippet) {
    state.replyToMsgId = msgId;
    const area = $('replyPreviewArea');
    $('replyPreviewText').textContent = `Replying: ${snippet}`;
    area.classList.remove('hidden');
    $('chatInput').focus();
}

function cancelReply() {
    state.replyToMsgId = null;
    $('replyPreviewArea').classList.add('hidden');
}

function handleChatFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10485760) return toast('File must be under 10MB.', 'error');
    state.chatFile = file;
    $('chatFileName').textContent = file.name;
    $('chatFilePreviewArea').classList.remove('hidden');
}

function cancelChatFile() {
    state.chatFile = null;
    $('chatFileInput').value = '';
    $('chatFilePreviewArea').classList.add('hidden');
}

async function loadChatMessages(silent = false) {
    if (!state.currentChatUserId && !state.currentChatGroupId) return;
    const container = $('chatMessages');
    const nearBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 50;

    let query = client.from('messages').select('*, sender:profiles!messages_sender_id_fkey(username), post:posts(id, description, media_url, media_type, profiles(username))');
    if (state.currentChatGroupId) query = query.eq('group_id', state.currentChatGroupId);
    else query = query.is('group_id', null).or(`and(sender_id.eq.${state.user.id},receiver_id.eq.${state.currentChatUserId}),and(sender_id.eq.${state.currentChatUserId},receiver_id.eq.${state.user.id})`);

    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) { if (!silent) container.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text2)">Error.</p>'; return; }
    if (!data) return;

    container.innerHTML = '';
    data.forEach(msg => {
        const isMe = msg.sender_id === state.user.id;
        const likedBy = msg.liked_by || [];
        const likedByMe = likedBy.includes(state.user.id);
        const w = document.createElement('div');
        w.className = `chat-msg-wrapper ${isMe ? 'sent' : 'received'}`;

        const m = document.createElement('div');
        m.className = `chat-msg ${isMe ? 'sent' : 'received'}`;

        if (!isMe && state.currentChatGroupId) {
            const nameColor = getStringColor(msg.sender?.username || '');
            m.innerHTML += `<div class="msg-sender-name" style="color:${nameColor}">${msg.sender?.username || 'Unknown'}</div>`;
        }

        if (msg.post) {
            let preview = '';
            if (msg.post.media_url) {
                if (msg.post.media_type === 'video' || /\.(mp4|webm|mov|ogg)$/i.test(msg.post.media_url)) {
                    preview = `<video src="${msg.post.media_url}" style="width:100%;max-height:160px;border-radius:6px;margin-bottom:6px;object-fit:cover;background:#000;" muted></video>`;
                } else {
                    preview = `<img src="${msg.post.media_url}" style="width:100%;max-height:160px;border-radius:6px;margin-bottom:6px;object-fit:cover;background:#000;">`;
                }
            }
            m.innerHTML += `<div class="shared-post-preview" onclick="viewPost('${msg.post.id}')" style="display:flex;flex-direction:column;">
                <div class="shared-post-header"><span class="material-icons" style="font-size:14px">post_add</span>Post from @${msg.post.profiles?.username || 'user'}</div>
                ${preview}<div class="shared-post-content">${msg.post.description || ''}</div></div>`;
        }

        if (msg.content) m.innerHTML += `<span>${msg.content}</span>`;
        if (msg.file_url) {
            if (/\.(mp4|webm|mov|ogg)$/i.test(msg.file_url)) {
                m.innerHTML += `<br><video src="${msg.file_url}" class="chat-file-preview" controls></video>`;
            } else {
                m.innerHTML += `<br><img src="${msg.file_url}" class="chat-file-preview">`;
            }
        }

        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let likesHtml = '';
        if (likedBy.length > 0) {
            if (state.currentChatGroupId) {
                likesHtml = `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--primary);margin-left:6px;"><span class="material-icons" style="font-size:12px">favorite</span>${likedBy.length}</span>`;
            } else {
                likesHtml = `<span class="material-icons chat-like-heart" style="font-size:12px">favorite</span>`;
            }
        }

        m.innerHTML += `<div class="msg-meta"><span>${time}</span>${isMe && !state.currentChatGroupId ? `<span class="material-icons msg-read-status ${msg.is_read ? 'read' : ''}">${msg.is_read ? 'done_all' : 'check'}</span>` : ''}</div>${likesHtml}`;

        // Actions
        const a = document.createElement('div');
        a.className = 'chat-actions';
        const safe = (msg.content || 'attachment').replace(/'/g, "\\'");
        let ah = `<span class="material-icons chat-action-btn" onclick="initiateReply('${msg.id}','${safe}')" style="font-size:16px;color:#777;cursor:pointer;padding:4px;">reply</span>`;
        if (!isMe) {
            const likedStr = JSON.stringify(likedBy).replace(/"/g, '&quot;');
            ah += `<span class="material-icons chat-action-btn" onclick="toggleChatLike('${msg.id}',${likedStr})" style="font-size:16px;color:#777;cursor:pointer;padding:4px;">${likedByMe ? 'favorite' : 'favorite_border'}</span>`;
        }
        a.innerHTML = ah;

        let clickTimer2 = null;
        m.addEventListener('click', (e) => {
            if (clickTimer2 === null) {
                clickTimer2 = setTimeout(() => { clickTimer2 = null; }, 250);
            } else {
                clearTimeout(clickTimer2); clickTimer2 = null;
                if (!isMe) toggleChatLike(msg.id, likedBy);
                e.preventDefault();
            }
        });

        w.appendChild(m);
        w.appendChild(a);
        container.appendChild(w);
    });

    if (!silent || nearBottom) container.scrollTop = container.scrollHeight;
}

async function toggleChatLike(msgId, likedBy) {
    let arr = [...(likedBy || [])];
    if (arr.includes(state.user.id)) arr = arr.filter(id => id !== state.user.id);
    else arr.push(state.user.id);
    await client.from('messages').update({ liked_by: arr }).eq('id', msgId);
    loadChatMessages(true);
}

async function sendChatMessage() {
    if (!state.user || (!state.currentChatUserId && !state.currentChatGroupId)) return;
    const input = $('chatInput');
    const content = input.value.trim();
    if (!content && !state.chatFile) return;
    input.disabled = true;

    let fileUrl = null;
    if (state.chatFile) {
        $('chatFileName').textContent = 'Uploading...';
        const name = `${state.user.id}_${Date.now()}_${state.chatFile.name}`;
        const { error: ue } = await client.storage.from('chat_files').upload(name, state.chatFile);
        if (ue) { toast('Upload failed', 'error'); input.disabled = false; $('chatFileName').textContent = state.chatFile.name; return; }
        fileUrl = client.storage.from('chat_files').getPublicUrl(name).data.publicUrl;
    }

    const payload = { sender_id: state.user.id, content };
    if (state.currentChatGroupId) payload.group_id = state.currentChatGroupId;
    else payload.receiver_id = state.currentChatUserId;
    if (state.replyToMsgId) payload.reply_to_id = state.replyToMsgId;
    if (fileUrl) payload.file_url = fileUrl;

    const { error } = await client.from('messages').insert([payload]);
    input.disabled = false;
    if (error) return toast('Failed: ' + error.message, 'error');
    input.value = '';
    input.style.height = 'auto';
    cancelReply();
    cancelChatFile();
    loadChatMessages(true);
}

// ─────── Inbox ───────
async function loadInbox() {
    const container = $('inboxList');
    container.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text2)">Loading...</p>';

    const { data: dms } = await client.from('messages').select(`
        id, content, created_at, is_read, sender_id, receiver_id, group_id,
        sender:profiles!messages_sender_id_fkey(id, username, avatar_url),
        receiver:profiles!messages_receiver_id_fkey(id, username, avatar_url)
    `).is('group_id', null)
    .or(`sender_id.eq.${state.user.id},receiver_id.eq.${state.user.id}`)
    .order('created_at', { ascending: false });

    const { data: myGroups } = await client.from('group_members').select('group_chats(id, name, avatar_url)').eq('user_id', state.user.id);

    const threads = {};
    if (myGroups) {
        for (const mg of myGroups) {
            const g = mg.group_chats;
            const { data: lm } = await client.from('messages').select('content, created_at').eq('group_id', g.id).order('created_at', { ascending: false }).limit(1);
            threads[`g_${g.id}`] = {
                isGroup: true, id: g.id, name: g.name, avatar: g.avatar_url || '',
                lastMsg: lm?.length ? lm[0].content : 'New group',
                time: lm?.length ? new Date(lm[0].created_at) : new Date(), unread: false
            };
        }
    }

    const seen = new Set();
    if (dms) {
        dms.forEach(msg => {
            const other = msg.sender_id === state.user.id ? msg.receiver : msg.sender;
            if (other && !seen.has(other.id)) {
                seen.add(other.id);
                threads[`d_${other.id}`] = {
                    isGroup: false, id: other.id, name: other.username, avatar: other.avatar_url || '',
                    lastMsg: msg.content || (msg.file_url ? 'Attachment' : ''),
                    time: new Date(msg.created_at),
                    unread: msg.receiver_id === state.user.id && !msg.is_read
                };
            }
        });
    }

    const sorted = Object.values(threads).sort((a, b) => b.time - a.time);
    container.innerHTML = '';
    if (!sorted.length) return container.innerHTML = '<p class="inbox-empty">No messages yet.</p>';

    sorted.forEach(t => {
        const row = document.createElement('div');
        row.className = 'list-user-row';
        row.onclick = () => t.isGroup ? openChat(null, t.id) : openChat(t.id, null);
        row.innerHTML = `<div class="post-avatar" style="background-image:url('${t.avatar}')">${t.isGroup && !t.avatar ? '<span class="material-icons" style="line-height:40px;text-align:center;width:100%;font-size:20px">group</span>' : ''}</div>
            <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:14px">${t.isGroup ? t.name : '@'+t.name}</div>
                <div style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.lastMsg}</div>
            </div>
            ${t.unread ? '<div style="width:10px;height:10px;border-radius:50%;background:var(--primary);flex-shrink:0"></div>' : ''}`;
        container.appendChild(row);
    });
}

// ─────── Message Polling ───────
async function pollMessages() {
    if (!state.user) return;
    const { count } = await client.from('messages').select('*', { count: 'exact', head: true }).eq('receiver_id', state.user.id).eq('is_read', false);
    const badge = $('unreadBadge');
    if (badge) {
        if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
        else badge.classList.add('hidden');
    }
    if (state.currentChatUserId || state.currentChatGroupId) loadChatMessages(true);
}

// ─────── Groups ───────
async function openCreateGroupModal() {
    showModal('createGroupModal');
    const c = $('groupMembersSelection');
    c.innerHTML = '<p style="color:var(--text2);padding:10px;">Loading...</p>';
    const { data } = await client.from('follows').select('profiles!follows_following_id_fkey(id, username, avatar_url)').eq('follower_id', state.user.id);
    c.innerHTML = '';
    if (!data || !data.length) return c.innerHTML = '<p style="color:var(--text2);padding:10px;">Follow people to add them!</p>';
    data.forEach(item => {
        const u = item.profiles;
        const label = document.createElement('label');
        label.className = 'group-member-row';
        label.innerHTML = `<input type="checkbox" class="group-user-cb" value="${u.id}"><div class="post-avatar" style="width:30px;height:30px;background-image:url('${u.avatar_url || ''}')"></div><span>@${u.username}</span>`;
        c.appendChild(label);
    });
}

function closeCreateGroupModal() {
    hideModal('createGroupModal');
    $('newGroupName').value = '';
    $('groupAvatarPreview').classList.add('hidden');
    $('groupAvatarPlaceholder').classList.remove('hidden');
}

function previewGroupAvatar(e) {
    const file = e.target.files[0];
    if (file) {
        $('groupAvatarPreview').src = URL.createObjectURL(file);
        $('groupAvatarPreview').classList.remove('hidden');
        $('groupAvatarPlaceholder').classList.add('hidden');
    }
}

async function createGroupChat() {
    const name = $('newGroupName').value.trim();
    if (!name) return toast('Enter a group name', 'error');
    const cbs = document.querySelectorAll('.group-user-cb:checked');
    const ids = Array.from(cbs).map(cb => cb.value);
    if (!ids.length) return toast('Select at least one member', 'error');

    let avatarUrl = null;
    const file = $('newGroupAvatar').files[0];
    if (file) {
        const fname = `group_${Date.now()}_${file.name}`;
        const { error: ue } = await client.storage.from('group_avatars').upload(fname, file);
        if (!ue) avatarUrl = client.storage.from('group_avatars').getPublicUrl(fname).data.publicUrl;
    }

    const { data: group, error: ge } = await client.from('group_chats').insert([{ name, created_by: state.user.id, avatar_url: avatarUrl }]).select().single();
    if (ge) return toast('Error: ' + ge.message, 'error');

    ids.push(state.user.id);
    await client.from('group_members').insert(ids.map(id => ({ group_id: group.id, user_id: id })));
    closeCreateGroupModal();
    loadInbox();
    toast('Group created!');
}

// ─────── Share Post ───────
async function openShareModal(postId) {
    state.sharePostId = postId;
    showModal('sharePostModal');
    const c = $('shareChatList');
    c.innerHTML = '<p style="color:var(--text2);padding:20px;">Loading...</p>';

    const [groupsRes, followsRes] = await Promise.all([
        client.from('group_members').select('group_chats(id, name, avatar_url)').eq('user_id', state.user.id),
        client.from('follows').select('profiles!follows_following_id_fkey(id, username, avatar_url)').eq('follower_id', state.user.id)
    ]);

    c.innerHTML = '';
    if (groupsRes.data) {
        groupsRes.data.forEach(mg => {
            const g = mg.group_chats;
            c.innerHTML += `<div class="list-user-row" onclick="sendPostToChat(null,'${g.id}')">
                <div class="post-avatar" style="background-image:url('${g.avatar_url || ''}')">${!g.avatar_url ? '<span class="material-icons" style="line-height:40px;text-align:center;width:100%;font-size:20px">group</span>' : ''}</div>
                <div style="flex:1;font-weight:600">${g.name}</div>
                <button class="btn-primary btn-small" style="width:auto">Send</button></div>`;
        });
    }
    if (followsRes.data) {
        followsRes.data.forEach(f => {
            const p = f.profiles;
            c.innerHTML += `<div class="list-user-row" onclick="sendPostToChat('${p.id}',null)">
                <div class="post-avatar" style="background-image:url('${p.avatar_url || ''}')"></div>
                <div style="flex:1;font-weight:600">@${p.username}</div>
                <button class="btn-primary btn-small" style="width:auto">Send</button></div>`;
        });
    }
}

function closeShareModal() {
    hideModal('sharePostModal');
    state.sharePostId = null;
}

async function sendPostToChat(userId, groupId) {
    if (!state.sharePostId) return;
    const payload = { sender_id: state.user.id, post_id: state.sharePostId, content: '' };
    if (groupId) payload.group_id = groupId;
    else payload.receiver_id = userId;
    const { error } = await client.from('messages').insert([payload]);
    if (error) return toast('Failed: ' + error.message, 'error');
    toast('Sent!');
    closeShareModal();
}

// ─────── Single Post ───────
async function viewPost(postId) {
    const c = $('singlePostContainer');
    c.innerHTML = '<p style="text-align:center;color:var(--text2);padding:50px;">Loading...</p>';
    showModal('singlePostModal');
    const { data: post, error } = await client.from('posts').select('*, profiles(username, avatar_url), likes(user_id), comments(id)').eq('id', postId).single();
    if (error || !post) return c.innerHTML = '<p style="text-align:center;color:var(--text2);padding:50px;">Post not found.</p>';
    c.innerHTML = '';
    const el = createPostElement(post);
    c.appendChild(el);
    const v = el.querySelector('video');
    if (v) setTimeout(() => v.play().catch(() => {}), 100);
}

function openSinglePost(post) {
    document.querySelectorAll('.post video').forEach(v => v.pause());
    const c = $('singlePostContainer');
    c.innerHTML = '';
    const el = createPostElement(post);
    c.appendChild(el);
    showModal('singlePostModal');
    const v = el.querySelector('video');
    if (v) setTimeout(() => v.play().catch(() => {}), 100);
}

function closeSinglePostModal() {
    hideModal('singlePostModal');
    const v = $('singlePostContainer').querySelector('video');
    if (v) v.pause();
    $('singlePostContainer').innerHTML = '';
}

// ─────── Auth State ───────
async function updateAuthState(session) {
    state.user = session?.user || null;
    if (state.user) {
        await Promise.all([fetchMyFollowings(), loadMyProfile()]);
        if (!state.messageInterval) state.messageInterval = setInterval(pollMessages, 3000);
    } else {
        state.profile = null;
        state.followings.clear();
        state.viewedPosts.clear();
        $('username').value = '';
        $('displayName').value = '';
        $('bio').value = '';
        $('avatarPreview').style.backgroundImage = 'none';
        $('myFollowersCount').textContent = '0';
        $('myFollowingCount').textContent = '0';
        $('myProfilePosts').innerHTML = '';
        if (state.messageInterval) { clearInterval(state.messageInterval); state.messageInterval = null; }
        toggleAuthView('login');
    }
}

// ─────── Init ───────
async function initializeApp() {
    const { data: { session } } = await client.auth.getSession();
    await updateAuthState(session);
    loadFeed();

    client.auth.onAuthStateChange(async (event, session) => {
        if (event === 'INITIAL_SESSION') return;
        await updateAuthState(session);
        if (event === 'SIGNED_IN') { hideModal('authModal'); switchTab('home'); }
        else if (event === 'SIGNED_OUT') switchTab('home');
    });

    // Input auto-resize
    document.querySelectorAll('textarea').forEach(t => {
        t.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        });
    });

    // Chat enter-to-send
    $('chatInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });
}

initializeApp();
