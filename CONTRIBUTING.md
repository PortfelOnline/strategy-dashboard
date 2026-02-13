# Contributing to AI Consultant India Strategy Dashboard

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## Getting Started

### Prerequisites
- Node.js 22.13.0+
- pnpm 10.4.1+
- Git
- MySQL database
- Meta App credentials (for testing Meta API features)

### Local Development Setup

1. **Clone the repository**
```bash
git clone https://github.com/PortfelOnline/strategy-dashboard.git
cd strategy-dashboard
```

2. **Install dependencies**
```bash
pnpm install
```

3. **Setup environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Setup database**
```bash
pnpm db:push
```

5. **Start development server**
```bash
pnpm dev
```

## Development Workflow

### Code Style

- **TypeScript**: Strict mode enabled
- **Formatting**: Prettier (run `pnpm format`)
- **Linting**: ESLint configuration included
- **Naming**: camelCase for variables/functions, PascalCase for components

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring
- `test/description` - Test additions

### Commit Messages

Follow conventional commits:
```
type(scope): description

[optional body]
[optional footer]
```

Examples:
- `feat(content): add hashtag suggestion feature`
- `fix(meta): handle OAuth token refresh error`
- `docs(readme): update installation instructions`
- `test(content): add content generation tests`

### Pull Request Process

1. Create feature branch from `main`
2. Make your changes
3. Run tests: `pnpm test`
4. Run type check: `pnpm check`
5. Format code: `pnpm format`
6. Commit with conventional messages
7. Push to your fork
8. Create pull request with clear description

## Project Structure Guidelines

### Adding New Features

#### 1. Backend Procedure (tRPC)

Add to `server/routers.ts`:
```typescript
content: router({
  myNewProcedure: protectedProcedure
    .input(z.object({
      // input schema
    }))
    .mutation(async ({ ctx, input }) => {
      // implementation
      return result;
    }),
}),
```

#### 2. Database Schema

Update `drizzle/schema.ts`:
```typescript
export const myTable = mysqlTable("my_table", {
  id: int("id").autoincrement().primaryKey(),
  // columns
});
```

#### 3. Database Helpers

Add to `server/db.ts`:
```typescript
export async function getMyData(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  return db.select().from(myTable).where(eq(myTable.userId, userId));
}
```

#### 4. Frontend Component

Create `client/src/pages/MyFeature.tsx`:
```typescript
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';

export default function MyFeature() {
  const { user } = useAuth();
  const { data, isLoading } = trpc.content.myNewProcedure.useQuery();
  
  return (
    <div>
      {/* component JSX */}
    </div>
  );
}
```

#### 5. Tests

Add to `server/content.test.ts`:
```typescript
describe("my feature", () => {
  it("should do something", async () => {
    const caller = appRouter.createCaller(ctx);
    const result = await caller.content.myNewProcedure({ /* input */ });
    expect(result).toBeDefined();
  });
});
```

## Testing Guidelines

### Running Tests
```bash
# Run all tests
pnpm test

# Run specific file
pnpm test server/content.test.ts

# Watch mode
pnpm test --watch
```

### Writing Tests

- Use Vitest framework
- Test both success and error cases
- Mock external dependencies
- Keep tests focused and isolated
- Use descriptive test names

Example:
```typescript
describe("content generation", () => {
  it("should generate content with valid input", async () => {
    const result = await generateContent({
      pillarType: "desi_business_owner",
      platform: "instagram",
      language: "hinglish",
    });
    
    expect(result).toHaveProperty("content");
    expect(result.content).toContain("#");
  });

  it("should throw error with invalid pillar type", async () => {
    await expect(
      generateContent({
        pillarType: "invalid",
        platform: "instagram",
      })
    ).rejects.toThrow();
  });
});
```

## Code Review Checklist

Before submitting PR, ensure:

- [ ] Code follows project style guide
- [ ] All tests pass: `pnpm test`
- [ ] TypeScript check passes: `pnpm check`
- [ ] Code is formatted: `pnpm format`
- [ ] Commit messages follow conventions
- [ ] PR description is clear and detailed
- [ ] No console.log statements left
- [ ] No commented-out code
- [ ] Database migrations are included (if schema changed)
- [ ] Documentation is updated

## Database Changes

When modifying database schema:

1. Update `drizzle/schema.ts`
2. Run `pnpm db:push` to generate migration
3. Test migration locally
4. Commit migration files
5. Update documentation

## API Changes

When adding/modifying API procedures:

1. Define input schema with Zod
2. Add procedure to appropriate router
3. Add corresponding database helper
4. Create frontend hook/component
5. Add tests
6. Update API documentation

## Documentation

- Update README.md for user-facing changes
- Add JSDoc comments to functions
- Document complex logic
- Include examples for new features
- Update CHANGELOG.md

## Performance Considerations

- Minimize database queries
- Use pagination for large datasets
- Cache frequently accessed data
- Optimize React components (useMemo, useCallback)
- Monitor bundle size

## Security Guidelines

- Never commit secrets or credentials
- Validate all user inputs
- Use parameterized queries
- Sanitize data before display
- Follow OWASP guidelines
- Report security issues privately

## Troubleshooting

### Common Issues

**Database connection error**
```bash
# Check DATABASE_URL in .env
# Ensure MySQL is running
# Verify credentials
```

**TypeScript errors**
```bash
# Run type check
pnpm check

# Clear cache and reinstall
rm -rf node_modules
pnpm install
```

**Tests failing**
```bash
# Run tests in verbose mode
pnpm test --reporter=verbose

# Check test file for issues
# Ensure test database is setup
```

## Questions or Need Help?

- Check existing issues and discussions
- Review documentation
- Ask in pull request comments
- Create new issue with detailed description

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help others learn and grow
- Report inappropriate behavior

## Recognition

Contributors will be recognized in:
- CONTRIBUTORS.md file
- Release notes
- Project documentation

Thank you for contributing! 🎉
