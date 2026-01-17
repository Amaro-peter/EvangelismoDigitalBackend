export const messages = {
  validation: {
    invalidData: 'Dados de registro inválidos!',
    userAlreadyExists: 'Já existe um usuário cadastrado com este CPF, E-mail ou Nome de Usuário.',
    churchAlreadyExists: 'Já existe uma igreja cadastrada com este nome e/ou coordenadas',
    invalidCpf: 'CPF inválido!',
    invalidJson: 'O corpo da requisição não está em formato JSON válido. Verifique a estrutura dos dados enviados.',
    invalidCep: 'CEP inválido!',
    passwordTooShort: 'A senha deve ter pelo menos 8 caracteres.',
    passwordTooLong: 'A senha deve ter no máximo 64 caracteres.',
    passwordUppercase: 'A senha deve conter pelo menos uma letra maiúscula.',
    passwordLowercase: 'A senha deve conter pelo menos uma letra minúscula.',
    passwordDigit: 'A senha deve conter pelo menos um número.',
    passwordSpecial: 'A senha deve conter pelo menos um caractere especial.',
    passwordNoSpaces: 'A senha não pode conter espaços.',
  },
  errors: {
    internalServer: 'Erro interno do servidor!',
    invalidCredentials: 'Credenciais inválidas!',
    resourceNotFound: 'Recurso não encontrado!',
    coordinatesNotFound: 'Coordenadas não encontradas para o endereço fornecido.',
    churchNotFound: 'Igreja não encontrada.',
    noAddressProvided: 'Nenhum endereço fornecido para conversão de CEP.',
    forbidden: 'Acesso negado!',
    unauthorized: 'Não autorizado!',
    invalidToken: 'Token inválido ou expirado!',
    passwordChangeRequired: 'É necessário alterar a senha antes de acessar o sistema!',
    formSubmissionFailed: 'Falha ao enviar o formulário.',
    createChurchFailed: 'Falha ao criar a igreja.',
    createUserFailed: 'Falha ao criar o usuário.',
    geoProviderFailureError: `
      Prezado usuário,
      Não conseguimos encontrar igrejas próximas agora.

      Estamos com uma instabilidade temporária ao localizar sua região a partir do CEP informado.

      Você pode tentar novamente em alguns instantes ou conferir se o CEP está correto. 
      Estamos trabalhando para normalizar o serviço o quanto antes.
    `.trim(),
    serviceOverloadError: 'Serviço sobrecarregado - tente novamente mais tarde',
    timeoutExceedOnFetch: 'Tempo limite excedido ao buscar dados externo.',
    noGeoProviderError:
      'Provedor resiliente de geolocalização requer pelo menos um provedor de geolocalização configurado.',
    noAddressProviderError: 'Provedor resiliente de endereço requer pelo menos um provedor de endereço configurado.',
    unexpectedFetchAddressFailError: 'Falha inesperada ao buscar o endereço.',
    operationAbortedError: 'Operação abortada pelo cache manager devido a timeout ou cancelamento.',
    addressProviderFailureError: 'Falha ao obter o endereço a partir do provedor de endereços.',
  },
  info: {
    passwordResetGeneric: 'Se o usuário existir, você receberá um e-mail com instruções para redefinir a senha.',
  },
  email: {
    passwordRecoverySubject: 'Recuperação de senha',
  },
  latitude: {
    outOfRange: 'A Latitude deve estar entre -90 e 90 graus.',
  },
  longitude: {
    outOfRange: 'A longitude deve estar entre -180 e 180 graus.',
  },
}

export type Messages = typeof messages
