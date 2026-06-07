// ─────── Supabase ───────
const SUPABASE_URL = 'https://etdkanqajrcxjytfxyyq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0ZGthbnFhanJjeGp5dGZ4eXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1OTIwNDYsImV4cCI6MjA5MjE2ODA0Nn0.-3KH6A6tfNvCeXPl7UIB92gL5BiO77ZrDEwlkbkZ1Ns';
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─────── Globals ───────
let currentUser = null;
let userProfile = null;
let myFollowings = new Set();
let currentViewProfileId = null;
let currentFeedMode = 'foryou';
let currentCommentPostId = null;
let currentChatUserId = null;
let currentChatGroupId = null;
let replyingToMsgId = null;
let chatAttachedFile = null;
let postToShareId = null;
let stagedFiles = [];

const viewedPosts = new Set();
const viewTimers = new Map();
let messageInterval = null;

// ─────── Toast ───────
function toast(msg, type = '') {
    const c = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// ─────── DOM Shortcuts ───────
const $ = id => document.getElementById(id);
function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }

function getStringColor(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
    const c = (h & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

// ─────── Observers ───────
const videoObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
        const v = e.target;
        const hidden = v.closest('.hidden');
        if (e.isIntersecting && !hidden) v.play().catch(() => {});
        else { v.pause(); v.currentTime = 0; }
    });
}, { threshold: 0.6 });

const feedObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
        const postId = e.target.id.replace('post-container-', '');
        if (e.isIntersecting) {
            const timer = setTimeout(() => {
                const el = $(`view-count-${postId}`);
                if (el) el.textContent = (parseInt(el.textContent) || 0) + 1;
                client.rpc('record_post_view', { p_user_id: currentUser?.id || null, p_post_id: postId }).catch(() => {});
            }, 1000);
            viewTimers.set(postId, timer);
        } else {
            if (viewTimers.has(postId)) { clearTimeout(viewTimers.get(postId)); viewTimers.delete(postId); }
        }
    });
}, { threshold: 0.6 });

// ─────── Keyboard & Visibility ───────
document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        document.querySelectorAll('.post video').forEach(v => {
            if (v.offsetParent !== null) {
                const r = v.getBoundingClientRect();
                if (r.top >= -window.innerHeight * 0.5 && r.bottom <= window.innerHeight * 1.5) {
                    v.paused ? v.play().catch(() => {}) : v.pause();
                }
            }
        });
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) document.querySelectorAll('video').forEach(v => v.pause());
    else document.querySelectorAll('.post video').forEach(v => {
        if (v.offsetParent !== null) {
            const r = v.getBoundingClientRect();
            if (r.top >= -window.innerHeight * 0.5 && r.bottom <= window.innerHeight * 1.5) v.play().catch(() => {});
        }
    });
});

// Feed scroll snap
let isScrolling = false;
const feedEl = $('feed');
feedEl?.addEventListener('wheel', e => {
    e.preventDefault();
    if (isScrolling) return;
    isScrolling = true;
    feedEl.scrollBy({ top: (e.deltaY > 0 ? 1 : -1) * window.innerHeight, behavior: 'smooth' });
    setTimeout(() => { isScrolling = false; }, 600);
}, { passive: false });

// ─────── Navigation ───────
function switchTab(tabId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const btn = $(`nav-${tabId}`);
    if (btn) btn.classList.add('active');

    document.querySelectorAll('#feed video').forEach(v => v.pause());
    hideModal('searchModal'); hideModal('uploadModal'); hideModal('profileModal'); hideModal('authModal');
    hideModal('viewProfileModal'); hideModal('singlePostModal'); hideModal('commentsModal');
    hideModal('messagesModal'); hideModal('chatModal'); hideModal('createGroupModal'); hideModal('sharePostModal');
    currentChatUserId = null; currentChatGroupId = null;

    if (tabId === 'home') {
        $('feed').classList.remove('hidden');
        $('topFeedNav').classList.remove('hidden');
        setTimeout(() => {
            $('feed').querySelectorAll('.post video').forEach(v => {
                const r = v.getBoundingClientRect();
                if (r.top >= -window.innerHeight * 0.5 && r.bottom <= window.innerHeight * 1.5) v.play().catch(() => {});
            });
        }, 100);
    } else {
        $('feed').classList.add('hidden');
        $('topFeedNav').classList.add('hidden');
        if (tabId === 'search') showModal('searchModal');
        else if (tabId === 'upload') { if (!currentUser) showModal('authModal'); else showModal('uploadModal'); }
        else if (tabId === 'profile') { if (!currentUser) showModal('authModal'); else showModal('profileModal'); }
        else if (tabId === 'messages') { if (!currentUser) showModal('authModal'); else { showModal('messagesModal'); loadInbox(); } }
    }
}

function switchFeedTab(mode) {
    currentFeedMode = mode;
    document.querySelectorAll('.top-nav-btn').forEach(b => b.classList.remove('active'));
    $(`tab-${mode}`).classList.add('active');
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
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) return toast(error.message, 'error');
    if (data.user) {
        const { error: pe } = await client.from('profiles').upsert({ id: data.user.id, username });
        if (pe) console.error(pe);
        toast('Check your email for confirmation!');
    }
}

async function signIn() {
    const email = $('loginEmail').value;
    const password = $('loginPassword').value;
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return toast(error.message, 'error');
    $('loginEmail').value = ''; $('loginPassword').value = '';
}

async function signOut() {
    await client.auth.signOut();
    hideModal('profileModal');
}

// ─────── Profile ───────
async function loadUserProfile() {
    if (!currentUser) return;
    const { data } = await client.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    if (data) {
        userProfile = data;
        $('username').value = data.username || '';
        $('displayName').value = data.display_name || '';
        $('bio').value = data.bio || '';
        $('avatarPreview').style.backgroundImage = data.avatar_url ? `url(${data.avatar_url})` : 'none';
    }
    const stats = await getFollowStats(currentUser.id);
    $('myFollowersCount').textContent = stats.followers;
    $('myFollowingCount').textContent = stats.following;

    const grid = $('myProfilePosts'); grid.innerHTML = '';
    const { data: posts } = await client.from('posts').select('*, profiles(username, avatar_url), likes(user_id), comments(id)').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    if (posts) posts.forEach(p => grid.appendChild(makeGridItem(p)));
}

async function saveProfile() {
    $('profileStatus').textContent = 'Saving...';
    const username = $('username').value;
    const displayName = $('displayName').value;
    const bio = $('bio').value;
    const file = $('avatarInput').files[0];
    let avatar_url = userProfile?.avatar_url || null;

    if (file) {
        const name = `${currentUser.id}_${Date.now()}`;
        const { error: ue } = await client.storage.from('avatars').upload(name, file);
        if (!ue) avatar_url = client.storage.from('avatars').getPublicUrl(name).data.publicUrl;
    }

    const { error } = await client.from('profiles').upsert({ id: currentUser.id, username, display_name: displayName, bio, avatar_url });
    if (error) return $('profileStatus').textContent = 'Error saving.';
    $('profileStatus').textContent = 'Saved!';
    await loadUserProfile();
    setTimeout(() => $('profileStatus').textContent = '', 2000);
}

function previewAvatar(e) {
    const f = e.target.files[0];
    if (f) $('avatarPreview').style.backgroundImage = `url(${URL.createObjectURL(f)})`;
}

// ─────── View Profile ───────
async function viewProfile(userId) {
    if (currentUser && userId === currentUser.id) return switchTab('profile');
    document.querySelectorAll('#feed video').forEach(v => v.pause());
    currentViewProfileId = userId;
    showModal('viewProfileModal');

    $('viewDisplayName').textContent = 'Loading...';
    $('viewDisplayName2').textContent = 'Loading...';
    $('viewUsername').textContent = '';
    $('viewBio').textContent = '';
    $('viewAvatar').style.backgroundImage = 'none';
    $('viewProfilePosts').innerHTML = '';

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
    if (currentUser) {
        fb.classList.remove('hidden'); mb.classList.remove('hidden');
        fb.textContent = myFollowings.has(userId) ? 'Following' : 'Follow';
        fb.classList.toggle('following', myFollowings.has(userId));
    } else {
        fb.classList.add('hidden'); mb.classList.add('hidden');
    }

    const { data: posts } = await client.from('posts').select('*, profiles(username, avatar_url), likes(user_id)').eq('user_id', userId).order('created_at', { ascending: false });
    if (posts) posts.forEach(p => $('viewProfilePosts').appendChild(makeGridItem(p)));
}

function closeViewProfileModal() {
    hideModal('viewProfileModal');
    if ($('feed').offsetParent !== null) {
        document.querySelectorAll('#feed video').forEach(v => {
            const r = v.getBoundingClientRect();
            if (r.top >= -window.innerHeight * 0.5 && r.bottom <= window.innerHeight * 1.5) v.play().catch(() => {});
        });
    }
}

function makeGridItem(post) {
    const w = document.createElement('div');
    w.className = 'grid-item';
    w.onclick = () => openSinglePost(post);
    const media = post.media_type === 'video'
        ? `<video src="${post.media_url}" muted playsinline></video>`
        : `<img src="${post.media_url}">`;
    w.innerHTML = `${media}<div class="grid-overlay"><span class="material-icons">visibility</span>${post.views || 0}</div>`;
    return w;
}

// ─────── Follows ───────
async function fetchMyFollowings() {
    if (!currentUser) return;
    const { data } = await client.from('follows').select('following_id').eq('follower_id', currentUser.id);
    if (data) myFollowings = new Set(data.map(f => f.following_id));
}

async function toggleFollow(event, targetUserId, isProfileView = false) {
    event.stopPropagation();
    if (!currentUser) return toast('Please login to follow!', 'error');
    const isFollowing = myFollowings.has(targetUserId);
    if (isFollowing) {
        await client.from('follows').delete().match({ follower_id: currentUser.id, following_id: targetUserId });
        myFollowings.delete(targetUserId);
    } else {
        await client.from('follows').insert([{ follower_id: currentUser.id, following_id: targetUserId }]);
        myFollowings.add(targetUserId);
    }
    if (isProfileView && currentViewProfileId) {
        viewProfile(currentViewProfileId);
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
    const c = $('listContainer');
    c.innerHTML = '<p style="text-align:center;color:var(--t2);padding:20px;">Loading...</p>';

    let q;
    if (type === 'followers') q = client.from('follows').select('profiles!follows_follower_id_fkey(id, username, avatar_url)').eq('following_id', userId);
    else q = client.from('follows').select('profiles!follows_following_id_fkey(id, username, avatar_url)').eq('follower_id', userId);

    const { data } = await q;
    c.innerHTML = '';
    if (!data?.length) return c.innerHTML = '<p style="text-align:center;color:var(--t2);padding:20px;">No users found.</p>';
    data.forEach(item => {
        const u = item.profiles;
        const row = document.createElement('div');
        row.className = 'list-user-row';
        row.onclick = () => { hideModal('listModal'); viewProfile(u.id); };
        row.innerHTML = `<div class="post-avatar" style="background-image:url('${u.avatar_url || ''}')"></div><span class="list-user-name">@${u.username || 'Anonymous'}</span>`;
        c.appendChild(row);
    });
}

// ─────── Feed ───────
async function loadFeed() {
    $('feed').innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--t2)">Loading...</div>';

    let query = client.from('posts').select('*, profiles(username, avatar_url), likes(user_id), comments(id), engagement_score');

    if (currentFeedMode === 'following') {
        if (!currentUser) return $('feed').innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--t2);padding:20px;text-align:center">Please login to see followed accounts.</div>';
        if (myFollowings.size === 0) return $('feed').innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--t2);padding:20px;text-align:center">You are not following anyone yet.</div>';
        query = query.in('user_id', Array.from(myFollowings));
    }

    const { data: posts, error } = await query.order('engagement_score', { ascending: false }).limit(60);
    if (error || !posts) return console.error('Feed error:', error);

    let unseen = [], seen = [];

    if (currentUser) {
        const { data: vd } = await client.from('post_views').select('post_id').eq('user_id', currentUser.id);
        const viewedIds = new Set(vd ? vd.map(v => v.post_id) : []);

        const { data: ul } = await client.from('likes').select('posts(tags)').eq('user_id', currentUser.id).limit(20);
        const prefs = {};
        if (ul) ul.forEach(l => {
            const lp = Array.isArray(l.posts) ? l.posts[0] : l.posts;
            if (lp && Array.isArray(lp.tags)) lp.tags.forEach(t => prefs[t] = (prefs[t] || 0) + 1);
        });

        posts.forEach(p => {
            let ts = 0;
            (p.tags || []).forEach(t => { if (prefs[t]) ts += prefs[t]; });
            p.calculated_score = p.engagement_score + (ts * 10);
            if (viewedIds.has(p.id)) seen.push(p); else unseen.push(p);
        });
        unseen.sort((a, b) => b.calculated_score - a.calculated_score);
        seen.sort((a, b) => b.calculated_score - a.calculated_score);
    } else {
        unseen = posts;
    }

    $('feed').innerHTML = '';
    $('feed').scrollTop = 0;

    unseen.forEach(p => $('feed').appendChild(createPostElement(p)));

    if (currentUser && seen.length > 0) {
        if (unseen.length > 0) {
            const div = document.createElement('div');
            div.className = 'caught-up';
            div.innerHTML = '<span class="material-icons">check_circle</span><h2>You\'re all caught up!</h2><p>Here are some older posts.</p>';
            $('feed').appendChild(div);
        }
        seen.forEach(p => $('feed').appendChild(createPostElement(p)));
    }

    setTimeout(() => {
        const fv = $('feed').querySelector('.post video');
        if (fv) fv.play().catch(() => {});
    }, 200);
}

// ─────── Post Element ───────
function createPostElement(post) {
    const div = document.createElement('div');
    div.className = 'post';
    div.id = `post-container-${post.id}`;

    const liked = currentUser && post.likes?.some(l => l.user_id === currentUser.id);
    const lc = post.likes?.length || 0;
    const cc = post.comments?.length || 0;
    const author = post.profiles?.username || 'Anonymous';
    const avatar = post.profiles?.avatar_url || '';
    const isFollowing = myFollowings.has(post.user_id);

    let mediaHtml = '';

    if (post.media_type === 'carousel' || (post.media_urls && post.media_urls.length > 1)) {
        const urls = post.media_urls || [post.media_url];
        const items = urls.map((u, i) => `<div class="carousel-item"><img src="${u}"></div>`).join('');
        const dots = urls.map((_, i) => `<div class="carousel-dot${i === 0 ? ' active' : ''}" id="dot-${post.id}-${i}"></div>`).join('');
        mediaHtml = `
            <button class="carousel-btn left material-icons" onclick="event.stopPropagation();scrollCarousel(event,'${post.id}',-1)">chevron_left</button>
            <div class="carousel-container" id="carousel-${post.id}" onscroll="updateCarouselDots('${post.id}',${urls.length})">${items}</div>
            <button class="carousel-btn right material-icons" onclick="event.stopPropagation();scrollCarousel(event,'${post.id}',1)">chevron_right</button>
            <div class="carousel-dots">${dots}</div>`;
    } else if (post.media_type === 'video') {
        mediaHtml = `<video src="${post.media_url}" loop playsinline></video><div class="play-indicator material-icons">play_arrow</div>`;
    } else {
        mediaHtml = `<img src="${post.media_url}">`;
    }

    let followBtn = '';
    if (currentUser && currentUser.id !== post.user_id) {
        followBtn = `<button class="feed-follow${isFollowing ? ' following' : ''}" onclick="toggleFollow(event,'${post.user_id}')">${isFollowing ? 'Following' : 'Follow'}</button>`;
    }

    let menuHtml = '';
    if (currentUser && post.user_id === currentUser.id) {
        menuHtml = `<button class="more-btn material-icons" onclick="event.stopPropagation();togglePostMenu(event)">more_vert</button>
            <div class="post-menu hidden"><button onclick="deletePost(event,'${post.id}','${post.user_id}')">Delete Post</button></div>`;
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
                <button class="action-btn${liked ? ' liked' : ''}" id="like-btn-${post.id}" onclick="toggleLike('${post.id}',this,this.querySelector('.action-count'))">
                    <span class="material-icons">${liked ? 'favorite' : 'favorite_border'}</span>
                    <span class="action-count" id="like-count-${post.id}">${lc}</span>
                </button>
                <button class="action-btn" onclick="openComments('${post.id}')">
                    <span class="material-icons">chat</span>
                    <span class="action-count" id="comment-count-${post.id}">${cc}</span>
                </button>
                <div class="action-btn">
                    <span class="material-icons">visibility</span>
                    <span class="action-count" id="view-count-${post.id}">${post.views || 0}</span>
                </div>
                <button class="action-btn" onclick="openShareModal('${post.id}')">
                    <span class="material-icons">send</span>
                </button>
            </div>
        </div>`;

    // Tap handling (single = pause, double = like)
    let clickTimer = null;
    div.addEventListener('click', e => {
        if (e.target.closest('.post-overlay') || e.target.closest('.more-btn')) return;
        if (clickTimer === null) {
            clickTimer = setTimeout(() => {
                clickTimer = null;
                const v = div.querySelector('video');
                if (v) v.paused ? v.play().catch(() => {}) : v.pause();
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
    if (!currentUser) return;
    const btn = $(`like-btn-${postId}`);
    if (btn) toggleLike(postId, btn, btn.querySelector('.action-count'));
}

// ─────── Carousel ───────
function scrollCarousel(event, postId, direction) {
    event.stopPropagation();
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
    event.stopPropagation();
    const menu = event.target.nextElementSibling;
    if (menu) menu.classList.toggle('hidden');
}

async function deletePost(event, postId, postUserId) {
    event.stopPropagation();
    if (!currentUser || currentUser.id !== postUserId) return toast('You can only delete your own posts.', 'error');
    if (!confirm('Delete this post?')) return;
    const { error } = await client.from('posts').delete().eq('id', postId).eq('user_id', currentUser.id);
    if (error) return toast('Failed: ' + error.message, 'error');
    const el = $(`post-container-${postId}`);
    if (el) el.remove();
    hideModal('singlePostModal');
    if (currentUser) loadUserProfile();
}

// ─────── Likes ───────
async function toggleLike(postId, btnElement, countElement) {
    if (!currentUser) return toast('Please login to like!', 'error');
    const isLiked = btnElement.classList.contains('liked');

    if (isLiked) {
        await client.from('likes').delete().match({ user_id: currentUser.id, post_id: postId });
        btnElement.classList.remove('liked');
        countElement.textContent = parseInt(countElement.textContent) - 1;
    } else {
        await client.from('likes').insert([{ user_id: currentUser.id, post_id: postId }]);
        btnElement.classList.add('liked');
        countElement.textContent = parseInt(countElement.textContent) + 1;
    }
}

// ─────── Comments ───────
function openComments(postId) {
    currentCommentPostId = postId;
    showModal('commentsModal');
    $('newCommentInput').value = '';
    $('postCommentBtn').onclick = () => postComment(postId);
    loadComments(postId);
}

async function loadComments(postId) {
    const list = $('commentsList');
    list.innerHTML = '<p style="text-align:center;color:var(--t2);padding:20px;">Loading...</p>';
    const { data, error } = await client.from('comments').select('*, profiles(username, avatar_url)').eq('post_id', postId).order('created_at', { ascending: true });
    if (error) return list.innerHTML = '<p style="text-align:center;color:var(--t2);padding:20px;">Error loading comments.</p>';
    if (!data?.length) return list.innerHTML = '<p style="text-align:center;color:var(--t2);padding:20px;">No comments yet. Be the first!</p>';
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

async function postComment(postId) {
    if (!currentUser) return toast('Please login to comment!', 'error');
    const input = $('newCommentInput');
    const content = input.value.trim();
    if (!content) return;
    input.disabled = true;
    const { error } = await client.from('comments').insert([{ post_id: postId, user_id: currentUser.id, content }]);
    input.disabled = false;
    if (error) return toast('Error: ' + error.message, 'error');
    input.value = '';
    await loadComments(postId);
    const el = $(`comment-count-${postId}`);
    if (el) el.textContent = parseInt(el.textContent) + 1;
}

// ─────── Upload ───────
function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    if (stagedFiles.length + files.length > 10) {
        toast('Max 10 files.', 'error');
        stagedFiles.push(...files.slice(0, 10 - stagedFiles.length));
    } else stagedFiles.push(...files);

    const hasVideo = stagedFiles.some(f => f.type.startsWith('video/'));
    if (hasVideo && stagedFiles.length > 1) {
        toast('Videos must be uploaded one at a time.', 'error');
        stagedFiles = [];
    }
    event.target.value = '';
    renderStagedFiles();
}

function removeStagedFile(index) {
    stagedFiles.splice(index, 1);
    renderStagedFiles();
}

function renderStagedFiles() {
    const c = $('stagedFilesContainer');
    c.innerHTML = '';
    if (!stagedFiles.length) return;

    stagedFiles.forEach((f, i) => {
        const url = URL.createObjectURL(f);
        const w = document.createElement('div');
        w.className = 'staged-file';
        w.innerHTML = `${f.type.startsWith('video/') ? `<video src="${url}" muted></video>` : `<img src="${url}">`}<button class="staged-file-remove" onclick="removeStagedFile(${i})">X</button>`;
        c.appendChild(w);
    });

    if (stagedFiles.length > 1) {
        const btn = document.createElement('button');
        btn.textContent = 'Clear All';
        btn.style.cssText = 'padding:6px 14px;font-size:12px;background:transparent;border:1px solid var(--border);color:var(--t2);border-radius:8px;cursor:pointer';
        btn.onclick = () => { stagedFiles = []; renderStagedFiles(); };
        c.appendChild(btn);
    }
}

async function uploadMedia() {
    if (!stagedFiles.length) return toast('Select at least one file', 'error');
    const status = $('uploadStatus');
    status.textContent = 'Uploading...';

    const type = stagedFiles[0].type.startsWith('video/') ? 'video' : (stagedFiles.length > 1 ? 'carousel' : 'image');
    const desc = $('postDescription').value;
    const hashtags = desc.match(/#[\w]+/g) || [];
    const tags = hashtags.map(t => t.replace('#', '').toLowerCase());

    const urls = [];
    for (let i = 0; i < stagedFiles.length; i++) {
        status.textContent = `Uploading ${i + 1}/${stagedFiles.length}...`;
        const name = `${Date.now()}_${stagedFiles[i].name}`;
        const { error: se } = await client.storage.from('media').upload(name, stagedFiles[i]);
        if (se) return status.textContent = 'Upload error: ' + se.message;
        urls.push(client.storage.from('media').getPublicUrl(name).data.publicUrl);
    }

    status.textContent = 'Saving...';
    const { error: dbe } = await client.from('posts').insert([{
        user_id: currentUser.id, media_url: urls[0], media_urls: urls,
        media_type: type, description: desc, tags
    }]);

    if (dbe) return status.textContent = 'Error: ' + dbe.message;
    status.textContent = 'Posted!';
    $('postDescription').value = '';
    stagedFiles = [];
    renderStagedFiles();
    setTimeout(() => { status.textContent = ''; switchTab('home'); }, 1000);
    if (currentUser) loadUserProfile();
}

// ─────── Search ───────
let searchTimeout;
async function searchUsers() {
    clearTimeout(searchTimeout);
    const q = $('searchInput').value.trim();
    const c = $('searchResults');
    if (!q) return c.innerHTML = '';
    searchTimeout = setTimeout(async () => {
        c.innerHTML = '<p style="text-align:center;color:var(--t2);padding:20px;">Searching...</p>';
        const { data, error } = await client.from('profiles').select('id, username, avatar_url').ilike('username', `%${q}%`).limit(20);
        if (error) return c.innerHTML = '<p style="text-align:center;color:var(--t2);padding:20px;">Error.</p>';
        c.innerHTML = '';
        if (!data?.length) return c.innerHTML = '<p style="text-align:center;color:var(--t2);padding:20px;">No users found.</p>';
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
    currentChatUserId = userId;
    currentChatGroupId = groupId;
    showModal('chatModal');
    $('chatMessages').innerHTML = '<p style="text-align:center;padding:40px;color:var(--t2)">Loading...</p>';

    if (groupId) {
        client.from('group_chats').select('*').eq('id', groupId).single().then(({ data: g }) => {
            if (g) {
                $('chatUsername').textContent = g.name;
                $('chatAvatar').style.backgroundImage = g.avatar_url ? `url(${g.avatar_url})` : 'none';
                $('chatAvatar').innerHTML = g.avatar_url ? '' : '<span class="material-icons" style="line-height:36px;text-align:center;width:100%;font-size:18px;color:var(--t2)">group</span>';
            }
        });
    } else {
        client.from('profiles').select('username, avatar_url').eq('id', userId).single().then(({ data: p }) => {
            if (p) {
                $('chatUsername').textContent = '@' + p.username;
                $('chatAvatar').style.backgroundImage = p.avatar_url ? `url(${p.avatar_url})` : 'none';
                $('chatAvatar').innerHTML = '';
                client.from('messages').update({ is_read: true }).eq('sender_id', userId).eq('receiver_id', currentUser.id).then(() => {});
            }
        });
    }
    setTimeout(loadChatMessages, 100);
}

function closeChat() {
    hideModal('chatModal');
    currentChatUserId = null; currentChatGroupId = null;
    replyingToMsgId = null; chatAttachedFile = null;
    cancelReply(); cancelChatFile();
    if (!$('messagesModal').classList.contains('hidden')) loadInbox();
}

function initiateReply(msgId, snippet) {
    replyingToMsgId = msgId;
    $('replyPreviewArea').classList.remove('hidden');
    $('replyPreviewText').textContent = 'Replying: ' + snippet;
    $('chatInput').focus();
}

function cancelReply() {
    replyingToMsgId = null;
    $('replyPreviewArea').classList.add('hidden');
}

function handleChatFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10485760) return toast('File must be under 10MB.', 'error');
    chatAttachedFile = file;
    $('chatFileName').textContent = file.name;
    $('chatFilePreviewArea').classList.remove('hidden');
}

function cancelChatFile() {
    chatAttachedFile = null;
    $('chatFileInput').value = '';
    $('chatFilePreviewArea').classList.add('hidden');
}

async function loadChatMessages(isSilentRefresh = false) {
    if (!currentChatUserId && !currentChatGroupId) return;
    const c = $('chatMessages');
    const nearBottom = c.scrollHeight - c.clientHeight <= c.scrollTop + 50;

    let query = client.from('messages').select('*, sender:profiles!messages_sender_id_fkey(username), post:posts(id, description, media_url, media_type, profiles(username))');
    if (currentChatGroupId) query = query.eq('group_id', currentChatGroupId);
    else query = query.is('group_id', null).or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${currentChatUserId}),and(sender_id.eq.${currentChatUserId},receiver_id.eq.${currentUser.id})`);

    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) { if (!isSilentRefresh) c.innerHTML = '<p style="text-align:center;padding:40px;color:var(--t2)">Error.</p>'; return; }
    if (!data) return;

    c.innerHTML = '';
    data.forEach(msg => {
        const isMe = msg.sender_id === currentUser.id;
        const likedBy = msg.liked_by || [];
        const likedByMe = likedBy.includes(currentUser.id);

        const w = document.createElement('div');
        w.className = `chat-msg-wrapper ${isMe ? 'sent' : 'received'}`;

        const m = document.createElement('div');
        m.className = `chat-msg ${isMe ? 'sent' : 'received'}`;

        if (!isMe && currentChatGroupId) {
            const color = getStringColor(msg.sender?.username || '');
            m.innerHTML += `<div class="msg-sender-name" style="color:${color}">${msg.sender?.username || 'Unknown'}</div>`;
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
            if (/\.(mp4|webm|mov|ogg)$/i.test(msg.file_url)) m.innerHTML += `<br><video src="${msg.file_url}" class="chat-file-preview" controls></video>`;
            else m.innerHTML += `<br><img src="${msg.file_url}" class="chat-file-preview">`;
        }

        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let lh = '';
        if (likedBy.length > 0) {
            if (currentChatGroupId) lh = `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--accent);margin-left:6px;"><span class="material-icons" style="font-size:12px">favorite</span>${likedBy.length}</span>`;
            else lh = `<span class="material-icons chat-like-heart" style="font-size:12px">favorite</span>`;
        }

        m.innerHTML += `<div class="msg-meta"><span>${time}</span>${isMe && !currentChatGroupId ? `<span class="material-icons msg-read-status ${msg.is_read ? 'read' : ''}">${msg.is_read ? 'done_all' : 'check'}</span>` : ''}</div>${lh}`;

        const a = document.createElement('div');
        a.className = 'chat-actions';
        const safe = (msg.content || 'attachment').replace(/'/g, "\\'");
        let ah = `<span class="material-icons chat-action-btn" onclick="initiateReply('${msg.id}','${safe}')">reply</span>`;
        if (!isMe) {
            const likedStr = JSON.stringify(likedBy).replace(/"/g, '&quot;');
            ah += `<span class="material-icons chat-action-btn" onclick="toggleChatLike('${msg.id}',${likedStr})">${likedByMe ? 'favorite' : 'favorite_border'}</span>`;
        }
        a.innerHTML = ah;

        let ct = null;
        m.addEventListener('click', e => {
            if (ct === null) ct = setTimeout(() => { ct = null; }, 250);
            else { clearTimeout(ct); ct = null; if (!isMe) toggleChatLike(msg.id, likedBy); e.preventDefault(); }
        });

        w.appendChild(m); w.appendChild(a);
        c.appendChild(w);
    });

    if (!isSilentRefresh || nearBottom) c.scrollTop = c.scrollHeight;
}

async function toggleChatLike(msgId, likedBy) {
    let arr = [...(likedBy || [])];
    if (arr.includes(currentUser.id)) arr = arr.filter(id => id !== currentUser.id);
    else arr.push(currentUser.id);
    await client.from('messages').update({ liked_by: arr }).eq('id', msgId);
    loadChatMessages(true);
}

async function sendChatMessage() {
    if (!currentUser || (!currentChatUserId && !currentChatGroupId)) return;
    const input = $('chatInput');
    const content = input.value.trim();
    if (!content && !chatAttachedFile) return;
    input.disabled = true;

    let fileUrl = null;
    if (chatAttachedFile) {
        $('chatFileName').textContent = 'Uploading...';
        const name = `${currentUser.id}_${Date.now()}_${chatAttachedFile.name}`;
        const { error: ue } = await client.storage.from('chat_files').upload(name, chatAttachedFile);
        if (ue) { toast('Upload failed', 'error'); input.disabled = false; $('chatFileName').textContent = chatAttachedFile.name; return; }
        fileUrl = client.storage.from('chat_files').getPublicUrl(name).data.publicUrl;
    }

    const payload = { sender_id: currentUser.id, content };
    if (currentChatGroupId) payload.group_id = currentChatGroupId;
    else payload.receiver_id = currentChatUserId;
    if (replyingToMsgId) payload.reply_to_id = replyingToMsgId;
    if (fileUrl) payload.file_url = fileUrl;

    const { error } = await client.from('messages').insert([payload]);
    input.disabled = false;
    if (error) return toast('Failed: ' + error.message, 'error');
    input.value = ''; input.style.height = 'auto';
    cancelReply(); cancelChatFile();
    loadChatMessages(true);
}

// ─────── Inbox ───────
async function loadInbox() {
    const c = $('inboxList');
    c.innerHTML = '<p style="text-align:center;padding:40px;color:var(--t2)">Loading...</p>';

    const { data: dms } = await client.from('messages').select(`
        id, content, created_at, is_read, sender_id, receiver_id, group_id,
        sender:profiles!messages_sender_id_fkey(id, username, avatar_url),
        receiver:profiles!messages_receiver_id_fkey(id, username, avatar_url)
    `).is('group_id', null)
    .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
    .order('created_at', { ascending: false });

    const { data: myGroups } = await client.from('group_members').select('group_chats(id, name, avatar_url)').eq('user_id', currentUser.id);

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
    if (dms) dms.forEach(msg => {
        const other = msg.sender_id === currentUser.id ? msg.receiver : msg.sender;
        if (other && !seen.has(other.id)) {
            seen.add(other.id);
            threads[`d_${other.id}`] = {
                isGroup: false, id: other.id, name: other.username, avatar: other.avatar_url || '',
                lastMsg: msg.content || (msg.file_url ? 'Attachment' : ''),
                time: new Date(msg.created_at),
                unread: msg.receiver_id === currentUser.id && !msg.is_read
            };
        }
    });

    const sorted = Object.values(threads).sort((a, b) => b.time - a.time);
    c.innerHTML = '';
    if (!sorted.length) return c.innerHTML = '<p style="text-align:center;color:var(--t2);padding:40px;">No messages yet.</p>';

    sorted.forEach(t => {
        const row = document.createElement('div');
        row.className = 'list-user-row';
        row.onclick = () => t.isGroup ? openChat(null, t.id) : openChat(t.id, null);
        row.innerHTML = `<div class="post-avatar" style="background-image:url('${t.avatar}')">${t.isGroup && !t.avatar ? '<span class="material-icons" style="line-height:40px;text-align:center;width:100%;font-size:20px;color:var(--t2)">group</span>' : ''}</div>
            <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:14px">${t.isGroup ? t.name : '@' + t.name}</div>
                <div style="font-size:12px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.lastMsg}</div>
            </div>
            ${t.unread ? '<div style="width:10px;height:10px;border-radius:50%;background:var(--accent);flex-shrink:0"></div>' : ''}`;
        c.appendChild(row);
    });
}

// ─────── Poll Messages ───────
async function pollMessages() {
    if (!currentUser) return;
    const { count } = await client.from('messages').select('*', { count: 'exact', head: true }).eq('receiver_id', currentUser.id).eq('is_read', false);
    const badge = $('unreadBadge');
    if (badge) {
        if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
        else badge.classList.add('hidden');
    }
    if (currentChatUserId || currentChatGroupId) loadChatMessages(true);
}

// ─────── Groups ───────
async function openCreateGroupModal() {
    showModal('createGroupModal');
    const c = $('groupMembersSelection');
    c.innerHTML = '<p style="color:var(--t2);padding:10px;">Loading...</p>';
    const { data } = await client.from('follows').select('profiles!follows_following_id_fkey(id, username, avatar_url)').eq('follower_id', currentUser.id);
    c.innerHTML = '';
    if (!data?.length) return c.innerHTML = '<p style="color:var(--t2);padding:10px;">Follow people to add them!</p>';
    data.forEach(item => {
        const u = item.profiles;
        const label = document.createElement('label');
        label.className = 'group-member-row';
        label.innerHTML = `<input type="checkbox" class="group-user-checkbox" value="${u.id}"><div class="post-avatar" style="width:30px;height:30px;background-image:url('${u.avatar_url || ''}')"></div><span>@${u.username}</span>`;
        c.appendChild(label);
    });
}

function closeCreateGroupModal() {
    hideModal('createGroupModal');
    $('newGroupName').value = '';
    $('groupAvatarPreview').classList.add('hidden');
    $('groupAvatarPlaceholder').classList.remove('hidden');
}

function previewGroupAvatar(event) {
    const file = event.target.files[0];
    if (file) {
        $('groupAvatarPreview').src = URL.createObjectURL(file);
        $('groupAvatarPreview').classList.remove('hidden');
        $('groupAvatarPlaceholder').classList.add('hidden');
    }
}

async function createGroupChat() {
    const name = $('newGroupName').value.trim();
    if (!name) return toast('Enter a group name', 'error');
    const cbs = document.querySelectorAll('.group-user-checkbox:checked');
    const ids = Array.from(cbs).map(cb => cb.value);
    if (!ids.length) return toast('Select at least one member', 'error');

    let avatarUrl = null;
    const file = $('newGroupAvatar').files[0];
    if (file) {
        const fname = `group_${Date.now()}_${file.name}`;
        const { error: ue } = await client.storage.from('group_avatars').upload(fname, file);
        if (!ue) avatarUrl = client.storage.from('group_avatars').getPublicUrl(fname).data.publicUrl;
    }

    const { data: group, error: ge } = await client.from('group_chats').insert([{ name, created_by: currentUser.id, avatar_url: avatarUrl }]).select().single();
    if (ge) return toast('Error: ' + ge.message, 'error');
    ids.push(currentUser.id);
    await client.from('group_members').insert(ids.map(id => ({ group_id: group.id, user_id: id })));
    closeCreateGroupModal();
    loadInbox();
    toast('Group created!');
}

// ─────── Share ───────
async function openShareModal(postId) {
    postToShareId = postId;
    showModal('sharePostModal');
    const c = $('shareChatList');
    c.innerHTML = '<p style="color:var(--t2);padding:20px;">Loading...</p>';

    const [gr, fr] = await Promise.all([
        client.from('group_members').select('group_chats(id, name, avatar_url)').eq('user_id', currentUser.id),
        client.from('follows').select('profiles!follows_following_id_fkey(id, username, avatar_url)').eq('follower_id', currentUser.id)
    ]);

    c.innerHTML = '';
    if (gr.data) gr.data.forEach(mg => {
        const g = mg.group_chats;
        c.innerHTML += `<div class="list-user-row" onclick="sendPostToChat(null,'${g.id}')">
            <div class="post-avatar" style="background-image:url('${g.avatar_url || ''}')">${!g.avatar_url ? '<span class="material-icons" style="line-height:40px;text-align:center;width:100%;font-size:20px;color:var(--t2)">group</span>' : ''}</div>
            <div style="flex:1;font-weight:600">${g.name}</div>
            <button class="btn-primary btn-sm" style="width:auto">Send</button></div>`;
    });
    if (fr.data) fr.data.forEach(f => {
        const p = f.profiles;
        c.innerHTML += `<div class="list-user-row" onclick="sendPostToChat('${p.id}',null)">
            <div class="post-avatar" style="background-image:url('${p.avatar_url || ''}')"></div>
            <div style="flex:1;font-weight:600">@${p.username}</div>
            <button class="btn-primary btn-sm" style="width:auto">Send</button></div>`;
    });
}

function closeShareModal() {
    hideModal('sharePostModal');
    postToShareId = null;
}

async function sendPostToChat(userId, groupId) {
    if (!postToShareId) return;
    const payload = { sender_id: currentUser.id, post_id: postToShareId, content: '' };
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
    c.innerHTML = '<p style="text-align:center;color:var(--t2);padding:50px;">Loading...</p>';
    showModal('singlePostModal');
    const { data: post, error } = await client.from('posts').select('*, profiles(username, avatar_url), likes(user_id), comments(id)').eq('id', postId).single();
    if (error || !post) return c.innerHTML = '<p style="text-align:center;color:var(--t2);padding:50px;">Post not found.</p>';
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
    currentUser = session?.user || null;
    if (currentUser) {
        await Promise.all([fetchMyFollowings(), loadUserProfile()]);
        if (!messageInterval) messageInterval = setInterval(pollMessages, 3000);
    } else {
        userProfile = null;
        myFollowings.clear();
        $('username').value = ''; $('displayName').value = ''; $('bio').value = '';
        $('avatarPreview').style.backgroundImage = 'none';
        $('myFollowersCount').textContent = '0'; $('myFollowingCount').textContent = '0';
        $('myProfilePosts').innerHTML = '';
        if (messageInterval) { clearInterval(messageInterval); messageInterval = null; }
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

    // Auto-resize textareas
    document.querySelectorAll('textarea').forEach(t => {
        t.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px'; });
    });

    // Chat Enter to send
    $('chatInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });
}

initializeApp();
