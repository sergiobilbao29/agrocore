using AgroCore.Application.DTOs;

namespace AgroCore.Application.Services.Interfaces;

public interface IAuthService
{
    Task<LoginResponse> LoginAsync(LoginRequest req, string? ip, string? userAgent, CancellationToken ct);
    Task<LoginResponse> RefreshAsync(RefreshRequest req, string? ip, string? userAgent, CancellationToken ct);
    Task LogoutAsync(string refreshToken, CancellationToken ct);
    Task ChangePasswordAsync(ChangePasswordRequest req, CancellationToken ct);
    Task<LoginResponse> CambiarEmpresaAsync(CambiarEmpresaRequest req, string? deviceId, CancellationToken ct);
}

public interface IEmpresaService
{
    Task<IReadOnlyList<EmpresaResumen>> ListarMisEmpresasAsync(CancellationToken ct);
}

public interface IUsuarioService
{
    Task<PagedResult<UsuarioResumen>> ListarAsync(int page, int pageSize, string? busqueda, CancellationToken ct);
    Task<int> CrearAsync(CrearUsuarioRequest req, CancellationToken ct);
    Task ActualizarAsync(int id, EditarUsuarioRequest req, CancellationToken ct);
    Task ActivarAsync(int id, bool activo, CancellationToken ct);
    Task AsignarRolesAsync(int usuarioId, List<AsignacionRol> asignaciones, CancellationToken ct);
}

public interface ICampoService
{
    Task<IReadOnlyList<CampoDto>> ListarAsync(CancellationToken ct);
    Task<CampoDto?> ObtenerAsync(int id, CancellationToken ct);
    Task<int> CrearAsync(CampoCreateDto dto, CancellationToken ct);
    Task ActualizarAsync(int id, CampoUpdateDto dto, CancellationToken ct);
    Task EliminarAsync(int id, CancellationToken ct);
}

public interface ILoteService
{
    Task<IReadOnlyList<LoteDto>> ListarAsync(int? campoId, CancellationToken ct);
    Task<LoteDto?> ObtenerAsync(int id, CancellationToken ct);
    Task<int> CrearAsync(LoteCreateDto dto, CancellationToken ct);
    Task ActualizarAsync(int id, LoteUpdateDto dto, CancellationToken ct);
    Task EliminarAsync(int id, CancellationToken ct);
}

public interface ICampanaService
{
    Task<PagedResult<CampanaDto>> ListarAsync(int page, int pageSize, int? loteId, string? estado, CancellationToken ct);
    Task<CampanaDto?> ObtenerAsync(int id, CancellationToken ct);
    Task<int> CrearAsync(CampanaCreateDto dto, CancellationToken ct);
    Task ActualizarAsync(int id, CampanaUpdateDto dto, CancellationToken ct);
    Task CerrarAsync(int id, CancellationToken ct);
    Task<MargenBrutoDto?> MargenBrutoAsync(int id, CancellationToken ct);
}

public interface IInsumoService
{
    Task<PagedResult<InsumoDto>> ListarAsync(int page, int pageSize, string? busqueda, string? tipo, bool soloBajoMinimo, CancellationToken ct);
    Task<InsumoDto?> ObtenerAsync(int id, CancellationToken ct);
    Task<int> CrearAsync(InsumoCreateDto dto, CancellationToken ct);
    Task ActualizarAsync(int id, InsumoUpdateDto dto, CancellationToken ct);
    Task<IReadOnlyList<InsumoDto>> AlertasStockBajoAsync(CancellationToken ct);
}

public interface ICompraService
{
    Task<PagedResult<CompraInsumoDto>> ListarAsync(int page, int pageSize, DateTime? desde, DateTime? hasta, int? proveedorId, CancellationToken ct);
    Task<CompraInsumoDto?> ObtenerAsync(int id, CancellationToken ct);
    Task<int> CrearAsync(CompraInsumoCreateDto dto, CancellationToken ct);
}

public interface IOrdenTrabajoService
{
    Task<PagedResult<OrdenTrabajoDto>> ListarAsync(int page, int pageSize, int? loteId, int? campanaId, string? estado, DateTime? desde, DateTime? hasta, CancellationToken ct);
    Task<OrdenTrabajoDetalleDto?> ObtenerAsync(int id, CancellationToken ct);
    Task<int> CrearAsync(OrdenTrabajoCreateDto dto, CancellationToken ct);
    Task EjecutarAsync(int id, OrdenTrabajoEjecutarDto dto, CancellationToken ct);
    Task FinalizarAsync(int id, CancellationToken ct);
    Task CancelarAsync(int id, string motivo, CancellationToken ct);
}

public interface IStockGranoService
{
    Task<IReadOnlyList<StockGranoDto>> StockActualAsync(CancellationToken ct);
    Task<int> RegistrarMovimientoAsync(MovimientoGranoCreateDto dto, CancellationToken ct);
}

public interface IHaciendaService
{
    Task<PagedResult<HaciendaDto>> ListarAsync(int page, int pageSize, string? categoria, string? estado, CancellationToken ct);
    Task<int> RegistrarMovimientoAsync(MovimientoHaciendaCreateDto dto, CancellationToken ct);
}

public interface IVentaService
{
    Task<int> CrearVentaGranoAsync(VentaGranoCreateDto dto, CancellationToken ct);
    Task<int> CrearVentaHaciendaAsync(VentaHaciendaCreateDto dto, CancellationToken ct);
    Task<int> CrearVentaPymeAsync(VentaPymeCreateDto dto, CancellationToken ct);
}

public interface ITesoreriaService
{
    Task<PagedResult<MovimientoCajaDto>> ListarMovimientosAsync(int page, int pageSize, DateTime? desde, DateTime? hasta, string? tipo, byte? monedaId, CancellationToken ct);
    Task<int> CrearMovimientoAsync(MovimientoCajaCreateDto dto, CancellationToken ct);
    Task<decimal[]> SaldosAsync(CancellationToken ct);
    Task<object> FlujoFondosAsync(DateTime desde, DateTime hasta, CancellationToken ct);
}

public interface IChequeService
{
    Task<PagedResult<ChequeDto>> ListarAsync(int page, int pageSize, string? tipo, string? estado, DateTime? vtoDesde, DateTime? vtoHasta, CancellationToken ct);
    Task<int> CrearAsync(ChequeCreateDto dto, CancellationToken ct);
    Task CambiarEstadoAsync(int id, ChequeCambioEstadoDto dto, CancellationToken ct);
}

public interface ICuentaCorrienteService
{
    Task<IReadOnlyList<CuentaCorrienteDto>> ListarAsync(string? tipo, CancellationToken ct);
    Task<IReadOnlyList<CuentaMovimientoDto>> MovimientosAsync(int cuentaCorrienteId, DateTime? desde, DateTime? hasta, CancellationToken ct);
    Task<int> CrearMovimientoAsync(CuentaMovimientoCreateDto dto, CancellationToken ct);
}

public interface IContratoService
{
    Task<IReadOnlyList<ContratoDto>> ListarAsync(bool soloActivos, CancellationToken ct);
    Task<int> CrearAsync(ContratoCreateDto dto, CancellationToken ct);
}

public interface IViajeCamionService
{
    Task<PagedResult<ViajeCamionDto>> ListarAsync(int page, int pageSize, DateTime? desde, DateTime? hasta, string? estado, CancellationToken ct);
    Task<int> CrearAsync(ViajeCamionCreateDto dto, CancellationToken ct);
    Task CambiarEstadoAsync(int id, string estado, decimal? kgDestino, decimal? merma, CancellationToken ct);
}

public interface IEmpleadoService
{
    Task<IReadOnlyList<EmpleadoDto>> ListarAsync(bool soloActivos, CancellationToken ct);
    Task<int> CrearAsync(EmpleadoCreateDto dto, CancellationToken ct);
}

public interface IComprobanteService
{
    Task<PagedResult<ComprobanteDto>> ListarAsync(int page, int pageSize, DateTime? desde, DateTime? hasta, byte? tipoId, int? puntoVentaId, CancellationToken ct);
    Task<int> CrearAsync(ComprobanteCreateDto dto, CancellationToken ct);
    Task SolicitarCaeAsync(int id, CancellationToken ct);
}

public interface IAdjuntoService
{
    Task<int> SubirAsync(Stream fileStream, string fileName, string? contentType, string entidad, string entidadId, CancellationToken ct);
    Task<(Stream stream, string contentType, string name)> DescargarAsync(int id, CancellationToken ct);
}

public interface IDashboardService
{
    Task<DashboardDto> GetAsync(CancellationToken ct);
}

public interface IMargenBrutoService
{
    Task<MargenBrutoDto?> CalcularCampanaAsync(int campanaId, CancellationToken ct);
    Task<IReadOnlyList<MargenBrutoDto>> TopCampanasAsync(int top, CancellationToken ct);
}

public interface ISyncService
{
    Task<SyncClientDto> RegistrarClienteAsync(SyncClientRegisterDto dto, CancellationToken ct);
    Task<SyncPushResponse> PushAsync(SyncPushRequest req, CancellationToken ct);
    Task<SyncPullResponse> PullAsync(Guid syncClientId, string? cursorB64, CancellationToken ct);
}

public interface IAuditService
{
    Task LogAsync(string entidad, string? entidadId, string accion, object? antes, object? despues, CancellationToken ct = default);
    Task LogEndpointAsync(int grupoId, int? empresaId, int? usuarioId, string path, string method, string? ip, string? userAgent);
}

public interface ICotizacionesService
{
    /// <summary>
    /// Devuelve la última cotización de granos (BCR/Matba) y dólar (BNA/DolarApi).
    /// Usa IMemoryCache con TTL de 10 minutos y fallback a valores semilla si
    /// las fuentes externas fallan.
    /// </summary>
    Task<CotizacionesResponseDto> GetAsync(CancellationToken ct = default);
}
