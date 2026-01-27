import { FormSubmission } from "@prisma/client";
import { FormsRepository } from "@repositories/forms-repository";
import { randomUUID } from "node:crypto";


export class InMemoryFormsSubmissionRepository implements FormsRepository {
    public items: FormSubmission[] = []

    async create(data: Omit<FormSubmission, 'id' | 'publicId' |'createdAt'>): Promise<FormSubmission> {
        const now = new Date()
        const formSubmission: FormSubmission = {
            id: this.items.length + 1,
            publicId: randomUUID(),
            createdAt: now,
            ...data
        } as FormSubmission

        this.items.push(formSubmission)
        return formSubmission
    }
    
}