export function contactInternalHtmlTemplate(name: string, lastName: string, email: string) {
  return `
            <div>
                <table style="font-family: arial">
                    <tr>
                        <td align="center" style="background-color: #eb5933; padding: 20px; color: white;">
                            <h1>Boas notícias!</h1>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding: 10px; font-size: 20px;">
                            <p>Um novo formulário acaba de ser enviado!</p>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding: 10px; font-size: 20px;">
                            <p><strong>Nome:</strong> ${name} ${lastName}</p>
                            <p><strong>Email:</strong> ${email}</p>
                        </td>
                    </tr>
                </table>
            </div>
        `
}
