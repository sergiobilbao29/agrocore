namespace AgroCore.Application.DTOs;

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize)
{
    public int TotalPages => (int)Math.Ceiling(Total / (double)PageSize);
}

public record SelectOption(int Id, string Nombre);

public record IdResponse(int Id);

public record MessageResponse(string Message);
