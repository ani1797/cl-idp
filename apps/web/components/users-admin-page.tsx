"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";

import { SectionHeader } from "@/components/brand/primitives";
import { ErrorCard } from "@/components/error-card";
import { PageLoadingState } from "@/components/page-loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  api,
  type AuthUser,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/lib/api";
import { showErrorToast } from "@/lib/errors";
import { USER_ROLES, isUserRole, type UserRole } from "@/lib/roles";

const usersQueryKey = ["users"] as const;

const roleLabelSchema = z
  .string()
  .trim()
  .min(1, "Role label is required.")
  .refine(isUserRole, "Choose one of the available roles.");

const createUserSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  displayName: z.string().trim().min(1, "Display name is required."),
  roleLabel: roleLabelSchema,
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const editUserSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required."),
  roleLabel: roleLabelSchema,
});

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

type CreateUserValues = {
  email: string;
  displayName: string;
  roleLabel: UserRole | "";
  password: string;
};
type EditUserValues = { displayName: string; roleLabel: UserRole | "" };
type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

type CreateUserErrors = Partial<Record<keyof CreateUserValues, string>>;
type EditUserErrors = Partial<Record<keyof EditUserValues, string>>;
type ResetPasswordErrors = Partial<Record<keyof ResetPasswordValues, string>>;

function buildCreateUserValues(): CreateUserValues {
  return {
    email: "",
    displayName: "",
    roleLabel: "",
    password: "",
  };
}

function mapUserToEditValues(user: AuthUser): EditUserValues {
  return {
    displayName: user.displayName,
    roleLabel: user.roleLabel,
  };
}

function buildResetPasswordValues(): ResetPasswordValues {
  return {
    password: "",
  };
}

function normalizeCreateUserInput(values: CreateUserValues): CreateUserInput {
  return {
    email: values.email.trim(),
    displayName: values.displayName.trim(),
    roleLabel: values.roleLabel.trim() as UserRole,
    password: values.password,
  };
}

function normalizeEditUserInput(values: EditUserValues): UpdateUserInput {
  return {
    displayName: values.displayName.trim(),
    roleLabel: values.roleLabel.trim() as UserRole,
  };
}

function validateCreateUser(values: CreateUserValues) {
  const parsed = createUserSchema.safeParse(values);

  if (parsed.success) {
    return { values: parsed.data, errors: {} satisfies CreateUserErrors };
  }

  return {
    values: null,
    errors: parsed.error.flatten().fieldErrors as CreateUserErrors,
  };
}

function validateEditUser(values: EditUserValues) {
  const parsed = editUserSchema.safeParse(values);

  if (parsed.success) {
    return { values: parsed.data, errors: {} satisfies EditUserErrors };
  }

  return {
    values: null,
    errors: parsed.error.flatten().fieldErrors as EditUserErrors,
  };
}

function validateResetPassword(values: ResetPasswordValues) {
  const parsed = resetPasswordSchema.safeParse(values);

  if (parsed.success) {
    return { values: parsed.data, errors: {} satisfies ResetPasswordErrors };
  }

  return {
    values: null,
    errors: parsed.error.flatten().fieldErrors as ResetPasswordErrors,
  };
}

function getFieldError(message?: string | string[]) {
  if (!message) {
    return null;
  }

  return Array.isArray(message) ? message[0] ?? null : message;
}

function FieldError({ message }: { message?: string | string[] }) {
  const text = getFieldError(message);

  if (!text) {
    return null;
  }

  return <p className="mt-1 text-xs text-destructive">{text}</p>;
}

function UserFormFields({
  mode,
  values,
  errors,
  disabled,
  onChange,
}: {
  mode: "create" | "edit";
  values: CreateUserValues | EditUserValues;
  errors: CreateUserErrors | EditUserErrors;
  disabled: boolean;
  onChange: <K extends keyof (CreateUserValues & EditUserValues)>(field: K, value: string) => void;
}) {
  const createErrors = errors as CreateUserErrors;
  const editErrors = errors as EditUserErrors;

  return (
    <div className="space-y-4">
      {mode === "create" ? (
        <div>
          <Label htmlFor="create-user-email">Email</Label>
          <Input
            id="create-user-email"
            type="email"
            value={(values as CreateUserValues).email}
            onChange={(event) => onChange("email", event.target.value)}
            disabled={disabled}
            aria-invalid={Boolean(getFieldError(createErrors.email))}
            aria-describedby={getFieldError(createErrors.email) ? "create-user-email-error" : undefined}
            placeholder="name@example.com"
          />
          <FieldError message={createErrors.email} />
        </div>
      ) : null}

      <div>
        <Label htmlFor={`${mode}-user-display-name`}>Display name</Label>
        <Input
          id={`${mode}-user-display-name`}
          value={values.displayName}
          onChange={(event) => onChange("displayName", event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(getFieldError(editErrors.displayName ?? createErrors.displayName))}
          placeholder="Alex Morgan"
        />
        <FieldError message={editErrors.displayName ?? createErrors.displayName} />
      </div>

      <div>
        <Label htmlFor={`${mode}-user-role-label`}>Role label</Label>
        <Select
          value={values.roleLabel}
          onValueChange={(value) => onChange("roleLabel", value)}
          disabled={disabled}
        >
          <SelectTrigger
            id={`${mode}-user-role-label`}
            className="w-full"
            aria-invalid={Boolean(getFieldError(editErrors.roleLabel ?? createErrors.roleLabel))}
          >
            <SelectValue placeholder="Choose a role" />
          </SelectTrigger>
          <SelectContent>
            {USER_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError message={editErrors.roleLabel ?? createErrors.roleLabel} />
        <p className="mt-2 text-xs text-muted-foreground">
          Controls what this user can see and do across the app.
        </p>
      </div>

      {mode === "create" ? (
        <div>
          <Label htmlFor="create-user-password">Temporary password</Label>
          <Input
            id="create-user-password"
            type="password"
            value={(values as CreateUserValues).password}
            onChange={(event) => onChange("password", event.target.value)}
            disabled={disabled}
            aria-invalid={Boolean(getFieldError(createErrors.password))}
            placeholder="Minimum 8 characters"
          />
          <FieldError message={createErrors.password} />
        </div>
      ) : null}
    </div>
  );
}

function formatUserCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function UsersAdminPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<AuthUser | null>(null);
  const [passwordUser, setPasswordUser] = useState<AuthUser | null>(null);
  const [createValues, setCreateValues] = useState<CreateUserValues>(buildCreateUserValues);
  const [createErrors, setCreateErrors] = useState<CreateUserErrors>({});
  const [editValues, setEditValues] = useState<EditUserValues | null>(null);
  const [editErrors, setEditErrors] = useState<EditUserErrors>({});
  const [passwordValues, setPasswordValues] = useState<ResetPasswordValues>(buildResetPasswordValues);
  const [passwordErrors, setPasswordErrors] = useState<ResetPasswordErrors>({});

  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    queryFn: api.listUsers,
  });

  const createMutation = useMutation({
    mutationFn: api.createUser,
    onSuccess: async (user) => {
      toast.success("User created", {
        description: `${user.displayName} can now sign in with ${user.email}.`,
      });
      setCreateOpen(false);
      setCreateValues(buildCreateUserValues());
      setCreateErrors({});
      await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
    onError: (error) => {
      showErrorToast(error, "Unable to create user");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: UpdateUserInput }) =>
      api.updateUser(userId, input),
    onSuccess: async (user) => {
      toast.success("User updated", {
        description: `${user.displayName}'s profile details were saved.`,
      });
      setEditUser(null);
      setEditValues(null);
      setEditErrors({});
      await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
    onError: (error) => {
      showErrorToast(error, "Unable to update user");
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ userId, nextIsActive }: { userId: string; nextIsActive: boolean }) =>
      api.updateUser(userId, { isActive: nextIsActive }),
    onSuccess: async (user, variables) => {
      toast.success(variables.nextIsActive ? "User reactivated" : "User deactivated", {
        description: `${user.displayName} is now ${variables.nextIsActive ? "active" : "inactive"}.`,
      });
      await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
    onError: (error, variables) => {
      showErrorToast(
        error,
        variables.nextIsActive ? "Unable to reactivate user" : "Unable to deactivate user",
      );
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      api.resetUserPassword(userId, password),
    onSuccess: async (_, variables) => {
      const user = usersQuery.data?.find((candidate) => candidate.id === variables.userId);
      toast.success("Password reset", {
        description: user ? `${user.displayName}'s password was updated.` : "The password was updated.",
      });
      setPasswordUser(null);
      setPasswordValues(buildResetPasswordValues());
      setPasswordErrors({});
      await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
    onError: (error) => {
      showErrorToast(error, "Unable to reset password");
    },
  });

  const users = useMemo(
    () =>
      [...(usersQuery.data ?? [])].sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
          left.email.localeCompare(right.email, undefined, { sensitivity: "base" }),
      ),
    [usersQuery.data],
  );

  const activeUsers = users.filter((user) => user.isActive).length;
  const inactiveUsers = users.length - activeUsers;

  const statusPendingUserId = statusMutation.isPending ? statusMutation.variables?.userId : undefined;

  function openCreateDialog() {
    setCreateValues(buildCreateUserValues());
    setCreateErrors({});
    setCreateOpen(true);
  }

  function openEditDialog(user: AuthUser) {
    setEditUser(user);
    setEditValues(mapUserToEditValues(user));
    setEditErrors({});
  }

  function openPasswordDialog(user: AuthUser) {
    setPasswordUser(user);
    setPasswordValues(buildResetPasswordValues());
    setPasswordErrors({});
  }

  function closeCreateDialog(open: boolean) {
    setCreateOpen(open);
    if (!open) {
      setCreateErrors({});
    }
  }

  function closeEditDialog(open: boolean) {
    if (!open) {
      setEditUser(null);
      setEditValues(null);
      setEditErrors({});
      return;
    }

    if (!editUser) {
      return;
    }

    setEditUser(editUser);
  }

  function closePasswordDialog(open: boolean) {
    if (!open) {
      setPasswordUser(null);
      setPasswordValues(buildResetPasswordValues());
      setPasswordErrors({});
    }
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { values, errors } = validateCreateUser(createValues);
    setCreateErrors(errors);

    if (!values) {
      return;
    }

    await createMutation.mutateAsync(normalizeCreateUserInput(values));
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editUser || !editValues) {
      return;
    }

    const { values, errors } = validateEditUser(editValues);
    setEditErrors(errors);

    if (!values) {
      return;
    }

    await updateMutation.mutateAsync({
      userId: editUser.id,
      input: normalizeEditUserInput(values),
    });
  }

  async function handleResetPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!passwordUser) {
      return;
    }

    const { values, errors } = validateResetPassword(passwordValues);
    setPasswordErrors(errors);

    if (!values) {
      return;
    }

    await resetPasswordMutation.mutateAsync({
      userId: passwordUser.id,
      password: values.password,
    });
  }

  if (usersQuery.isLoading) {
    return (
      <PageLoadingState
        title="Loading users"
        description="Fetching the current admin user directory and account status."
      />
    );
  }

  if (usersQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <ErrorCard
          title="Could not load users"
          message="The user directory could not be loaded. Please try again."
          onRetry={() => void usersQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-gutter">
        <section className="flex flex-col gap-gutter">
          <div className="flex flex-col gap-gutter md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h1 className="text-headline-lg text-foreground">Users</h1>
                <Badge variant="neutral" className="text-label-caps">
                  {formatUserCount(users.length, "user", "users")}
                </Badge>
                <Badge variant="success" className="text-label-caps">
                  {formatUserCount(activeUsers, "active", "active")}
                </Badge>
              </div>
              <p className="text-body-md text-muted-foreground">
                Provision and maintain backend-authenticated users for the IDP admin experience.
              </p>
            </div>
            <Button type="button" onClick={openCreateDialog}>
              <Icon name="add_circle" size={20} />
              Create user
            </Button>
          </div>

          {users.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center">
                <div className="mx-auto max-w-2xl">
                  <h2 className="text-headline-md text-foreground">Create your first user</h2>
                  <p className="mt-3 text-body-md text-muted-foreground">
                    No user accounts have been provisioned yet. Add a user to grant access to the
                    authenticated admin and review workflows.
                  </p>
                  <div className="mt-6">
                    <Button type="button" onClick={openCreateDialog}>
                      <Icon name="add_circle" size={20} />
                      Create user
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="border-b pb-3">
                <SectionHeader
                  title="User directory"
                  description="Manage account details, access status, and password resets."
                  actions={
                    <Badge variant="neutral" className="h-8 px-3 text-label-caps">
                      {formatUserCount(inactiveUsers, "inactive", "inactive")}
                    </Badge>
                  }
                />
              </CardHeader>
              <CardContent className="px-0">
                <Table className="min-w-[840px]">
                  <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-gutter text-label-caps text-muted-foreground">
                        User
                      </TableHead>
                      <TableHead className="px-gutter text-label-caps text-muted-foreground">
                        Email
                      </TableHead>
                      <TableHead className="px-gutter text-label-caps text-muted-foreground">
                        Role label
                      </TableHead>
                      <TableHead className="px-gutter text-label-caps text-muted-foreground">
                        Status
                      </TableHead>
                      <TableHead className="px-gutter text-right text-label-caps text-muted-foreground">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => {
                      const rowStatusPending = statusPendingUserId === user.id;

                      return (
                        <TableRow key={user.id} className="align-top">
                          <TableCell className="px-gutter py-3 whitespace-normal">
                            <div className="flex items-start gap-2">
                              <span className="mt-0.5 rounded-lg bg-primary/10 p-1.5 text-primary">
                                <Icon name="person" size={18} />
                              </span>
                              <div className="min-w-0">
                                <p className="font-heading text-sm font-semibold text-foreground">
                                  {user.displayName}
                                </p>
                                <p className="mt-1 font-mono text-xs text-muted-foreground">
                                  {user.id}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-gutter py-3 text-muted-foreground">
                            {user.email}
                          </TableCell>
                          <TableCell className="px-gutter py-3 whitespace-normal">
                            <Badge variant="outline">{user.roleLabel}</Badge>
                          </TableCell>
                          <TableCell className="px-gutter py-3">
                            <Badge
                              variant={user.isActive ? "success" : "neutral"}
                              className="text-label-caps"
                            >
                              {user.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-gutter py-3">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => openEditDialog(user)}>
                                <Icon name="edit" size={16} />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => openPasswordDialog(user)}
                              >
                                <Icon name="lock" size={16} />
                                Reset password
                              </Button>
                              <Button
                                type="button"
                                variant={user.isActive ? "destructive" : "secondary"}
                                size="sm"
                                disabled={rowStatusPending}
                                onClick={() =>
                                  statusMutation.mutate({
                                    userId: user.id,
                                    nextIsActive: !user.isActive,
                                  })
                                }
                              >
                                <Icon name={user.isActive ? "block" : "verified_user"} size={16} />
                                {rowStatusPending
                                  ? "Updating…"
                                  : user.isActive
                                    ? "Deactivate"
                                    : "Reactivate"}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </section>
      </div>

      <Dialog open={createOpen} onOpenChange={closeCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Add a new sign-in for the backend auth service.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateSubmit}>
            <UserFormFields
              mode="create"
              values={createValues}
              errors={createErrors}
              disabled={createMutation.isPending}
              onChange={(field, value) => {
                setCreateValues((current) => ({ ...current, [field]: value }));
              }}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={createMutation.isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editUser && editValues)} onOpenChange={closeEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>
              Update the display name and role label shown across the application.
            </DialogDescription>
          </DialogHeader>
          {editValues ? (
            <form className="space-y-4" onSubmit={handleEditSubmit}>
              <UserFormFields
                mode="edit"
                values={editValues}
                errors={editErrors}
                disabled={updateMutation.isPending}
                onChange={(field, value) => {
                  setEditValues((current) => (current ? { ...current, [field]: value } : current));
                }}
              />
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={updateMutation.isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(passwordUser)} onOpenChange={closePasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              {passwordUser ? `Set a new password for ${passwordUser.displayName}.` : "Set a new password."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleResetPasswordSubmit}>
            <div>
              <Label htmlFor="reset-user-password">New password</Label>
              <Input
                id="reset-user-password"
                type="password"
                value={passwordValues.password}
                onChange={(event) => setPasswordValues({ password: event.target.value })}
                disabled={resetPasswordMutation.isPending}
                aria-invalid={Boolean(getFieldError(passwordErrors.password))}
                placeholder="Minimum 8 characters"
              />
              <FieldError message={passwordErrors.password} />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={resetPasswordMutation.isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? "Resetting…" : "Reset password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
