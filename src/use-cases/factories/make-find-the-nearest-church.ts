import {FindTheNearestChurchUseCase} from '@use-cases/churches/find-the-nearest-church'

export function makeFindTheNearestChurchesUseCase() {
    const findTheNearestChurchesUseCase = new FindTheNearestChurchUseCase()
    
    return findTheNearestChurchesUseCase
}