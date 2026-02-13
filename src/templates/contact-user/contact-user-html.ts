export function contactUserHtmlTemplate(name: string) {
  return `
            <div>
                <table style="font-family: arial">
                    <tr>
                        <td align="center" style="background-color: #eb5933; padding: 20px; color: white;">
                            <h1>Estamos aqui!</h1>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding: 10px; font-size: 20px;">
                            <p>Graça e paz, <strong>${name}</strong>!</p>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding: 10px; font-size: 20px;">
                            <p>Recebemos sua mensagem. É uma honra que você esteja se conectando conosco!</p>
                            <p>Você será adicionado à nossa lista de e-mails para receber atualizações, recursos e inspiração para lhe auxiliar na sua jornada.</p>
                        </td>
                    </tr>
                </table>
            </div>
        `
}
