import Link from 'next/link'
import Image from 'next/image'
import { FundingType } from '@prisma/client'
import { ProgressBar } from './progress-bar'
import { formatJpy } from '@/lib/fees'
import { formatTimeLeft, progressRate } from '@/lib/utils'

export type ProjectCardData = {
  slug: string
  title: string
  coverImageUrl: string | null
  categoryName: string | null
  categoryEmoji: string | null
  creatorName: string
  currentAmount: number
  goalAmount: number
  backerCount: number
  endAt: Date
  fundingType: FundingType
}

export function ProjectCard({ project }: { project: ProjectCardData }) {
  const rate = progressRate(project.currentAmount, project.goalAmount)

  return (
    <article className="group overflow-hidden rounded-lg border border-border bg-bg shadow-card transition-shadow hover:shadow-card-hover">
      <Link href={`/projects/${project.slug}`} className="block">
        <div className="relative aspect-video overflow-hidden bg-bg-muted">
          {project.coverImageUrl ? (
            <Image
              src={project.coverImageUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            />
          ) : (
            <div
              className="flex h-full items-center justify-center text-4xl"
              aria-hidden
            >
              {project.categoryEmoji ?? '🎵'}
            </div>
          )}
          {project.categoryName && (
            <span className="absolute left-3 top-3 rounded-full bg-bg/90 px-2.5 py-1 text-xs font-medium text-fg-secondary backdrop-blur">
              {project.categoryName}
            </span>
          )}
        </div>

        <div className="p-4">
          <p className="truncate text-[13px] text-fg-muted">{project.creatorName}</p>

          <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-fg">
            {project.title}
          </h3>

          <ProgressBar rate={rate} className="mt-3" />

          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabular text-lg font-bold text-fg">
              {formatJpy(project.currentAmount)}
            </span>
            <span className="tabular text-sm font-medium text-fg-secondary">{rate}%</span>
          </div>

          <p className="mt-1 text-[13px] text-fg-muted">
            支援者{project.backerCount}人 · {formatTimeLeft(project.endAt)}
          </p>
        </div>
      </Link>
    </article>
  )
}
