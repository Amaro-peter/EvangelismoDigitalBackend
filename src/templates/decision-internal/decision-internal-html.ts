export function decisionInternalHtmlTemplate(name: string, email: string, location?: string) {
  return `
            <p>
                Nova decisão por Cristo:
            </p>
            <ul>
                <li>
                    Nome: ${name}
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
