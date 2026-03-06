import { IErrorDetail } from 'core/contracts/errors/error-detail.interface'

export const FORM_SUBMISSION_ERROR: IErrorDetail = {
  code: 'FORM_SUBMISSION_ERROR',
  message: 'Ocorreu um erro ao submeter o formulário.',
}

export const FORM_ALREADY_EXISTS_ERROR: IErrorDetail = {
  code: 'FORM_ALREADY_EXISTS',
  message: 'Já existe um formulário submetido com este email.',
}

export const FORM_NOT_FOUND_ERROR: IErrorDetail = {
  code: 'FORM_NOT_FOUND',
  message: 'Nenhum formulário encontrado para o email fornecido.',
}
