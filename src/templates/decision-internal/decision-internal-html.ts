export function decisionInternalHtmlTemplate(name: string, lastName: string, email: string, location?: string) {
  return `
            <p>
                Nova decisão por Cristo:
            </p>
            <ul>
                <li>
                    Nome: ${name} ${lastName}
                </li>
                <li>
                    Email: ${email}
                </li>
                <li>
                    Local: ${location ?? 'não informado'}
                </li>
            </ul>
        `
}
