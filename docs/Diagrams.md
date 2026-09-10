# Use Case & Sequence Diagrams

## Use Case Diagram

```mermaid
graph LR
    SM((Store Manager))
    AC((Area Coach))
    EX((Executive))
    AD((Admin))

    SM --> UC1[View Sales]
    SM --> UC2[Generate Roster]
    SM --> UC3[Record Actual Hours]
    SM --> UC4[View Productivity]

    AC --> UC4
    AC --> UC5[Compare Stores]

    EX --> UC6[View Company Dashboard]
    EX --> UC7[View Labor Cost]
    EX --> UC8[View Top/Worst Store]

    AD --> UC9[Manage Users]
    AD --> UC10[Import Excel]
    AD --> UC11[Manage Stores & Labor Guidelines]
```

> Note: these roles/permissions are already modeled in `Role.permissions` and
> checked by the `authorize`/`storeScope` middleware, but every request
> currently authenticates as a fixed Admin-equivalent identity (login is
> deferred — see README §6), so in practice every use case above is reachable
> by anyone right now.

## Sequence Diagram — Auto Roster Generation

```mermaid
sequenceDiagram
    participant M as Store Manager (UI)
    participant API as Express API
    participant S as rosterGenerationService
    participant DB as Supabase (PostgreSQL)

    M->>API: POST /roster/auto-generate {storeId, startDate, endDate, regenerate}
    API->>API: authenticate (fixed identity) + authorize(schedule:generate) + storeScope
    API->>S: generateDraftRoster(params)
    S->>DB: fetch store's LaborGuideline, active employees, hourly forecast, monthly capacity
    DB-->>S: rows
    S->>S: size staffing per hour from the forecast, productivity floor, and daily/monthly budgets
    loop each day
        S->>S: guarantee opening (09:00) + closing (22:00) coverage, then fill to the operational minimum
        S->>S: Full-time = 8 working hours + 1h break (9h clock span); Part-time = 4-8h
        S->>S: enforce weekly hours, 6-consecutive-day rest, no double booking, monthly capacity
    end
    S->>DB: replace Shift rows for the range (create/reuse one Roster row per ISO week)
    DB-->>S: roster with shifts
    S-->>API: result (rosterIds, shifts, validation)
    API-->>M: 201 { result } — status always DRAFT, never auto-approved
```

## Sequence Diagram — Recording Actual Hours

```mermaid
sequenceDiagram
    participant M as Store Manager (UI)
    participant API as Express API
    participant L as laborService
    participant DB as PostgreSQL

    M->>API: PUT /labor {shiftId, actualHours}
    API->>L: recordActualHours(params)
    L->>DB: find Shift by id
    DB-->>L: shift (plannedHours)
    L->>DB: upsert ActualHours (1:1 with shift)
    DB-->>L: actualHours row
    L->>L: isOverPlanned = actualHours > plannedHours
    L-->>API: { ...record, isOverPlanned }
    API-->>M: 200 { record } (+ warning message if over planned hours)
```

## Sequence Diagram — Sales Forecast

```mermaid
sequenceDiagram
    participant U as Admin/Manager (UI)
    participant API as Express API
    participant F as forecastService
    participant DB as PostgreSQL

    U->>API: POST /forecast {storeId, days, method}
    API->>F: generateForecast(params)
    F->>DB: fetch SalesRecord history (lookback window)
    DB-->>F: rows
    F->>DB: create ForecastModelRun (model_version)
    loop each future day
        F->>F: compute forecast (SMA or Linear Regression)
        F->>DB: upsert SalesForecast row (linked to model_run_id)
    end
    F-->>API: { method, daily, weeklyTotal }
    API-->>U: 200 { forecast }
```
