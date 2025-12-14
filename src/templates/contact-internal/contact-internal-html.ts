export function contactInternalHtmlTemplate(name: string, lastName: string, email: string) {
  return `
            <p>
                Novo formulário enviado:
            </p>
            <ul>
                <li>
                    Nome: ${name} ${lastName}
                </li>
                <li>
                    Email: ${email}
                </li>
            </ul>
        `
}
