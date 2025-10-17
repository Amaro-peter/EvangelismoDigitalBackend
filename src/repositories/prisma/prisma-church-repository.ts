import { prisma } from "@lib/prisma";
import { Prisma } from "@prisma/client";
import { ChurchRepository } from "@repositories/church-repository";


export class PrismaChurchRepository implements ChurchRepository {
  async create(data: Prisma.ChurchCreateInput) {
    const church = await prisma.$queryRaw`
    INSERT INTO churches (name, address, lat, lon, geog)
    VALUES (
      ${data.name},
      ${data.address},
      ${data.lat},
      ${data.lon},
      ST_SetSRID(ST_MakePoint(${data.lon}, ${data.lat}), 4326)
    )
    RETURNING *;
  `

    return church;
  }
}