import { env } from '@env/index'

export function forgotPasswordTextTemplate(userName: string, token: string) {
  const url = `${env.FRONTEND_URL}/reset-password/${token}`
  const appName = env.APP_NAME
  return `
Olá, ${userName}!

Recebemos uma solicitação para redefinir a sua senha. Para continuar, acesse o link abaixo:

${url}

Se você não solicitou a recuperação de senha, ignore este e-mail.

Atenciosamente,
Equipe ${appName}
  `.trim()
}
