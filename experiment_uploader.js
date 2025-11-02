/**
 * 实验数据上传逻辑：通过 GitHub Actions 匿名触发器安全上传
 * 注意：您必须在 GitHub Secrets 中设置 REPO_WRITE_TOKEN
 */

// ============ GitHub Actions 触发配置 ============

// !!! 1. 替换为您的 GitHub 用户名 (Owner) !!!
const GITHUB_OWNER = 'ohmytong'; 

// !!! 2. 替换为您的 GitHub 仓库名称 (Repo) !!!
const GITHUB_REPO = 'json-data-storage'; 

// GitHub Actions 工作流监听的事件类型 (与 upload_data.yml 中的 types 字段匹配)
const ACTION_EVENT_TYPE = 'data_upload';

// GitHub API 的公共端点，用于触发 Events
const DISPATCH_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`;


function uploadToServer(data, participantId) {
    
    // ⚠️ 注意：此请求不包含任何密钥（PAT），因为它使用的是公共的 dispatch 端点。
    // 真正的授权在 GitHub Actions 工作流内部完成。

    const payload = {
        // 必须包含 event_type 字段，与 upload_data.yml 中的 types 匹配
        event_type: ACTION_EVENT_TYPE, 
        
        // client_payload 包含我们发送给 Actions 工作流的数据
        client_payload: {
            participant_id: participantId,
            data: data, // 包含 trials 和 post 问卷的完整数据
            timestamp: new Date().toISOString()
        }
    };
    
    return fetch(DISPATCH_API_URL, {
        method: 'POST',
        headers: {
            // Content-Type 必须是 JSON
            'Content-Type': 'application/json',
            // 必须发送 User-Agent 头，否则 GitHub API 会拒绝请求
            'User-Agent': GITHUB_OWNER
        },
        body: JSON.stringify(payload)
    })
    .then(response => {
        // 成功触发 dispatch 事件返回的状态码是 202 Accepted
        if (response.status === 202) {
            console.log('✅ GitHub Actions 触发成功 (202 Accepted)。等待 Actions 运行写入文件。');
            return { success: true, message: 'Actions workflow successfully triggered.' };
        } 
        
        // 处理其他错误，例如 404 (仓库名或事件类型错误) 或 403 (速率限制)
        return response.json().then(error => {
            console.error('GitHub API 触发失败:', error);
            throw new Error(`Actions 触发失败 (${response.status}): ${error.message || response.statusText}`);
        });
    });
}
