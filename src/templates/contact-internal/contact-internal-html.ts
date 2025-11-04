export function contactInternalHtmlTemplate(name: string, email: string) {
  return `
            <p>
                Novo formulário enviado:
            </p>
            <ul>
                <li>
                    Nome: ${name}
                </li>
                <li>
                    Email: ${email}
                </li>
            </ul>
        `
}
