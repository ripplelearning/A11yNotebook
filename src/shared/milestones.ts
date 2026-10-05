export type MilestoneStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export interface MilestoneTaskAssociation {
  path: string;
  taskId: string;
}

export interface MilestoneProgress {
  total: number;
  completed: number;
  missing: number;
  percentage: number;
  summary: string;
}

export interface Milestone {
  id: string;
  title: string;
  dueDate: string;
  status: MilestoneStatus;
  notePaths: string[];
  tasks: MilestoneTaskAssociation[];
  createdAt: string;
  updatedAt: string;
  progress: MilestoneProgress;
}

export type MilestoneRecord = Omit<Milestone, 'progress'>;

export interface MilestoneStore {
  version: 1;
  milestones: MilestoneRecord[];
}

export interface NewMilestone {
  title: string;
  dueDate: string;
  status: MilestoneStatus;
  notePaths?: string[];
  tasks?: MilestoneTaskAssociation[];
}

export type MilestoneUpdate = Partial<NewMilestone>;
