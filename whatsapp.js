const axios = require('axios');

const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

/**
 * Send text message to individual (private chat)
 */
async function sendTextMessage(to, text) {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'text',
      text: {
        preview_url: false,
        body: text
      }
    };
    
    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Message sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending message:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send message to group chat
 */
async function sendGroupMessage(groupId, text) {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      to: groupId,
      type: 'text',
      text: {
        preview_url: false,
        body: text
      }
    };
    
    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Message sent to group ${groupId}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending group message:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send message with image
 */
async function sendImageMessage(to, imageUrl, caption) {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'image',
      image: {
        link: imageUrl,
        caption: caption || ''
      }
    };
    
    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Image sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending image:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send interactive reply buttons to a private chat (DM only — not supported in groups)
 * buttons: array of { id, title } — max 3, title max 20 chars
 */
async function sendButtonMessage(to, bodyText, buttons) {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map(b => ({
            type: 'reply',
            reply: {
              id: b.id,
              title: b.title.substring(0, 20)
            }
          }))
        }
      }
    };

    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Button message sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending button message:', JSON.stringify(error.response?.data || error.message));
    throw error;
  }
}

/**
 * Send interactive list message to a private chat (DM only — not supported in groups)
 * sections: array of { title, rows: [{ id, title, description }] }
 * Row title max 24 chars, description max 72 chars
 */
async function sendListMessage(to, bodyText, buttonLabel, sections) {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonLabel.substring(0, 20),
          sections: sections.map(s => ({
            title: s.title,
            rows: s.rows.map(r => ({
              id: r.id,
              title: r.title.substring(0, 24),
              description: r.description ? r.description.substring(0, 72) : undefined
            }))
          }))
        }
      }
    };

    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ List message sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error('❌ Error sending list message:', JSON.stringify(error.response?.data || error.message));
    throw error;
  }
}

/**
 * Mark message as read
 */
async function markAsRead(messageId) {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    };
    
    await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('⚠️ Error marking message as read:', error.message);
  }
}

module.exports = {
  sendTextMessage,
  sendGroupMessage,
  sendImageMessage,
  sendButtonMessage,
  sendListMessage,
  markAsRead
};
