import axios from 'axios';

export async function postNotification({
  webhookURL,
  message
}: {
  webhookURL: string
  message: string
}) {
  // 
  try {
    // ignoring "Property 'post' does not exist on type 'typeof import(...)'"
    // @ts-ignore
    const resp = await axios.post(
    webhookURL,
      {
        text: message
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      },
    )
    return resp.data
  } catch (err) {
    console.error('Error sending slack message:', err)
  }
}
